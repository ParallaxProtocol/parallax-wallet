import { createContext, useContext } from "react";

/**
 * The node's power switch, shared by the node bar and the node's page under
 * it: one busy state and one error, so whichever button was pressed, the
 * other shows it connecting too.
 */
export type NodeSwitch = {
  busy: boolean;
  err: string | null;
  /** Starts the node when it's stopped, stops it when it's running. */
  toggle: () => Promise<void>;
  /** Whether the node is restarting: stopped to start again, as a setting it reads only as it starts asks. */
  restarting: boolean;
  /** Stops the node and starts it again, the bar saying so meanwhile; throws why it didn't start. */
  restart: () => Promise<void>;
  /**
   * Why the stopped node can't start yet, for its start buttons to show in
   * place of their label, disabled: Tor is on and not connected, and the
   * node goes behind it or not at all. null when it can start.
   */
  waiting: string | null;
};

export const NodeSwitchContext = createContext<NodeSwitch>({
  busy: false,
  err: null,
  toggle: async () => {},
  restarting: false,
  restart: async () => {},
  waiting: null,
});

export const useNodeSwitch = () => useContext(NodeSwitchContext);
