// Copyright 2026 The Parallax Authors
// This file is part of the Parallax library.

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
)

// Sealed calls keep what the window and the backend say to each other out
// of the Electron shell's main process, which carries every call between
// them (desktop/src/main.ts): passwords, recovery phrases and keys, and
// what comes back, pass through it encrypted, never in the clear.
//
// The window's preload script (desktop/src/preload.ts) opens a session
// with BridgeOpen, an X25519 exchange: both sides derive an AES-256-GCM
// key from it (HKDF-SHA256 over the shared secret, salted with both public
// keys), which never leaves them. Each call is then Sealed: its method and
// arguments encrypted under the session's key, and its response the same
// way back. The shell sees the public keys and ciphertext only.
//
// A secret method (secretMethods) is served only sealed, so no path, now
// or later, can carry one through the shell in the clear. The shell's own
// calls (locking the wallet as the computer sleeps, reading the config)
// carry nothing secret, and stay plain.

const (
	sealOpenMethod = "BridgeOpen"
	sealedMethod   = "Sealed"
	// The HKDF info, naming what the key is for and the version of this scheme
	sealInfo = "parallax-bridge-seal 1"
	// What each direction's ciphertext is bound to, so a call's can't be
	// passed off as a response's
	sealCallAAD   = "call"
	sealResultAAD = "result"
	// The sessions kept: a window opens one each time it loads
	maxSealSessions = 8
)

// errUnknownSession is what a sealed call under a session the backend
// doesn't have (any more) is answered: the preload opens a new one.
const errUnknownSession = "sealed: unknown session"

// sealedMessage is a sealed call or response: its session, and its nonce
// and ciphertext in standard base64.
type sealedMessage struct {
	Session string `json:"s"`
	Nonce   string `json:"n"`
	Data    string `json:"c"`
}

// sealOpened is BridgeOpen's answer: the session, and the backend's public key.
type sealOpened struct {
	Session string `json:"session"`
	Key     string `json:"key"`
}

// sealSessions are the open sessions' keys, the oldest dropped past
// maxSealSessions.
type sealSessions struct {
	mu    sync.Mutex
	keys  map[string]cipher.AEAD
	order []string
}

func (s *sealSessions) get(id string) cipher.AEAD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.keys[id]
}

// open answers a window's public key with a new session.
func (s *sealSessions) open(peerKey []byte) (sealOpened, error) {
	peer, err := ecdh.X25519().NewPublicKey(peerKey)
	if err != nil {
		return sealOpened{}, err
	}
	own, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return sealOpened{}, err
	}
	shared, err := own.ECDH(peer)
	if err != nil {
		return sealOpened{}, err
	}
	defer clear(shared)
	ownKey := own.PublicKey().Bytes()
	salt := append(append(make([]byte, 0, len(peerKey)+len(ownKey)), peerKey...), ownKey...)
	key, err := hkdf.Key(sha256.New, shared, salt, sealInfo, 32)
	if err != nil {
		return sealOpened{}, err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return sealOpened{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return sealOpened{}, err
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return sealOpened{}, err
	}
	id := hex.EncodeToString(raw)

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.keys == nil {
		s.keys = map[string]cipher.AEAD{}
	}
	s.keys[id] = aead
	s.order = append(s.order, id)
	for len(s.order) > maxSealSessions {
		delete(s.keys, s.order[0])
		s.order = s.order[1:]
	}
	return sealOpened{Session: id, Key: base64.StdEncoding.EncodeToString(ownKey)}, nil
}

// handleOpen serves BridgeOpen: {"method":"BridgeOpen","args":["<public key>"]}.
func (b *bridge) handleOpen(body []byte) (int, []byte) {
	var req struct {
		Args []string `json:"args"`
	}
	if err := json.Unmarshal(body, &req); err != nil || len(req.Args) != 1 {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: BridgeOpen takes a public key"})
	}
	peerKey, err := base64.StdEncoding.DecodeString(req.Args[0])
	if err != nil {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: " + err.Error()})
	}
	opened, err := b.sessions.open(peerKey)
	if err != nil {
		return marshalResponse(http.StatusOK, callResponse{Error: err.Error()})
	}
	return marshalResponse(http.StatusOK, callResponse{Result: opened})
}

// handleSealed serves a sealed call: {"method":"Sealed","args":[<sealedMessage>]}.
// The call is opened, run (under erasing if it's a secret one) and its
// response sealed back; what was opened is cleared once it's served.
func (b *bridge) handleSealed(body []byte) (int, []byte) {
	var req struct {
		Args []sealedMessage `json:"args"`
	}
	if err := json.Unmarshal(body, &req); err != nil || len(req.Args) != 1 {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: Sealed takes one sealed call"})
	}
	msg := req.Args[0]
	aead := b.sessions.get(msg.Session)
	if aead == nil {
		return marshalResponse(http.StatusOK, callResponse{Error: errUnknownSession})
	}
	nonce, err1 := base64.StdEncoding.DecodeString(msg.Nonce)
	sealed, err2 := base64.StdEncoding.DecodeString(msg.Data)
	if err := errors.Join(err1, err2); err != nil || len(nonce) != aead.NonceSize() {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: malformed sealed call"})
	}
	plain, err := aead.Open(make([]byte, 0, len(sealed)), nonce, sealed, []byte(sealCallAAD))
	clear(sealed)
	if err != nil {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: sealed call doesn't open"})
	}
	defer clear(plain)

	var head struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(plain, &head); err != nil {
		return marshalResponse(http.StatusBadRequest, callResponse{Error: "bad request: " + err.Error()})
	}
	var out sealedMessage
	var sealErr error
	serve := func() {
		_, response := b.respond(plain)
		defer clear(response)
		nonce := make([]byte, aead.NonceSize())
		if _, sealErr = rand.Read(nonce); sealErr != nil {
			return
		}
		out = sealedMessage{
			Session: msg.Session,
			Nonce:   base64.StdEncoding.EncodeToString(nonce),
			Data:    base64.StdEncoding.EncodeToString(aead.Seal(nil, nonce, response, []byte(sealResultAAD))),
		}
	}
	if secretMethods[head.Method] {
		erasing(serve)
	} else {
		serve()
	}
	if sealErr != nil {
		return marshalResponse(http.StatusInternalServerError, callResponse{Error: sealErr.Error()})
	}
	return marshalResponse(http.StatusOK, callResponse{Result: out})
}

func marshalResponse(status int, resp callResponse) (int, []byte) {
	out, err := json.Marshal(resp)
	if err != nil {
		return http.StatusInternalServerError, []byte(`{"result":null,"error":"unencodable result"}`)
	}
	return status, append(out, '\n')
}
