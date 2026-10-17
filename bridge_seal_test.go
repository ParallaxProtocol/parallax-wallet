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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// sealClient plays the window's preload (desktop/src/preload.ts): it opens
// a session and seals its calls, as the shell would carry them.
type sealClient struct {
	t       *testing.T
	b       *bridge
	session string
	aead    cipher.AEAD
}

func (c *sealClient) post(body any) (int, callResponse) {
	c.t.Helper()
	raw, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	c.b.handleCall(rec, httptest.NewRequest(http.MethodPost, "/call", strings.NewReader(string(raw))))
	var resp callResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		c.t.Fatalf("response %q: %v", rec.Body.String(), err)
	}
	return rec.Code, resp
}

func openSealClient(t *testing.T, b *bridge) *sealClient {
	t.Helper()
	own, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	c := &sealClient{t: t, b: b}
	code, resp := c.post(map[string]any{"method": "BridgeOpen", "args": []string{base64.StdEncoding.EncodeToString(own.PublicKey().Bytes())}})
	if code != http.StatusOK || resp.Error != "" {
		t.Fatalf("BridgeOpen: %d %s", code, resp.Error)
	}
	var opened sealOpened
	raw, _ := json.Marshal(resp.Result)
	json.Unmarshal(raw, &opened)
	theirs, _ := base64.StdEncoding.DecodeString(opened.Key)
	peer, err := ecdh.X25519().NewPublicKey(theirs)
	if err != nil {
		t.Fatal(err)
	}
	shared, _ := own.ECDH(peer)
	key, _ := hkdf.Key(sha256.New, shared, append(own.PublicKey().Bytes(), theirs...), sealInfo, 32)
	block, _ := aes.NewCipher(key)
	c.aead, _ = cipher.NewGCM(block)
	c.session = opened.Session
	return c
}

// seal seals what's given under the session, for the direction aad names.
func (c *sealClient) seal(plain []byte, aad string) sealedMessage {
	nonce := make([]byte, c.aead.NonceSize())
	rand.Read(nonce)
	return sealedMessage{
		Session: c.session,
		Nonce:   base64.StdEncoding.EncodeToString(nonce),
		Data:    base64.StdEncoding.EncodeToString(c.aead.Seal(nil, nonce, plain, []byte(aad))),
	}
}

// call makes a sealed call and opens its response.
func (c *sealClient) call(method string, args ...any) callResponse {
	c.t.Helper()
	plain, _ := json.Marshal(map[string]any{"method": method, "args": args})
	code, resp := c.post(map[string]any{"method": "Sealed", "args": []sealedMessage{c.seal(plain, sealCallAAD)}})
	if code != http.StatusOK || resp.Error != "" {
		c.t.Fatalf("%s sealed: %d %s", method, code, resp.Error)
	}
	var back sealedMessage
	raw, _ := json.Marshal(resp.Result)
	json.Unmarshal(raw, &back)
	nonce, _ := base64.StdEncoding.DecodeString(back.Nonce)
	data, _ := base64.StdEncoding.DecodeString(back.Data)
	opened, err := c.aead.Open(nil, nonce, data, []byte(sealResultAAD))
	if err != nil {
		c.t.Fatalf("%s: response doesn't open: %v", method, err)
	}
	var inner callResponse
	if err := json.Unmarshal(opened, &inner); err != nil {
		c.t.Fatalf("%s: response %q: %v", method, opened, err)
	}
	return inner
}

func TestSealedCall(t *testing.T) {
	b, err := newBridge(&App{}, newHub())
	if err != nil {
		t.Fatal(err)
	}
	c := openSealClient(t, b)

	// A call, and a secret one (served now: with no wallet it says so), each answered sealed
	if resp := c.call("Profile"); resp.Error != "" {
		t.Errorf("Profile: %s", resp.Error)
	}
	if resp := c.call("WalletSetupPassword", "correct horse battery"); resp.Error == "" || strings.Contains(resp.Error, "sealed") {
		t.Errorf("WalletSetupPassword sealed: %q, want the wallet's own error", resp.Error)
	}

	// Ciphertext changed on the way doesn't open
	plain, _ := json.Marshal(map[string]any{"method": "Profile", "args": []any{}})
	tampered := c.seal(plain, sealCallAAD)
	data, _ := base64.StdEncoding.DecodeString(tampered.Data)
	data[0] ^= 1
	tampered.Data = base64.StdEncoding.EncodeToString(data)
	if code, resp := c.post(map[string]any{"method": "Sealed", "args": []sealedMessage{tampered}}); code != http.StatusBadRequest {
		t.Errorf("tampered: %d %s", code, resp.Error)
	}
	// Nor does a response passed off as a call
	if code, resp := c.post(map[string]any{"method": "Sealed", "args": []sealedMessage{c.seal(plain, sealResultAAD)}}); code != http.StatusBadRequest {
		t.Errorf("a response as a call: %d %s", code, resp.Error)
	}
	// A session the backend hasn't is said to be unknown, for the window to open another
	unknown := c.seal(plain, sealCallAAD)
	unknown.Session = "0"
	if _, resp := c.post(map[string]any{"method": "Sealed", "args": []sealedMessage{unknown}}); resp.Error != errUnknownSession {
		t.Errorf("unknown session: %q", resp.Error)
	}
	// Sessions past maxSealSessions drop the oldest
	for range maxSealSessions {
		openSealClient(t, b)
	}
	if _, resp := c.post(map[string]any{"method": "Sealed", "args": []sealedMessage{c.seal(plain, sealCallAAD)}}); resp.Error != errUnknownSession {
		t.Errorf("oldest session kept past the limit: %q", resp.Error)
	}
}
