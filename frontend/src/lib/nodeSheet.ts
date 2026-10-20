import { createContext, useContext } from "react";

// Whether the node bar is opened into the node's page, for the shell and
// for whatever opens it (the /node route). Apart from the bar (NodeBar.tsx),
// so a hot update of the bar never makes a second context. Opened, it rises
// as far as the page needs; full, as the page's "More details" asks, up to
// the window's title bar
type Sheet = {
  open: boolean;
  setOpen: (open: boolean) => void;
  full: boolean;
  setFull: (full: boolean) => void;
};
export const NodeSheetContext = createContext<Sheet>({
  open: false,
  setOpen: () => {},
  full: false,
  setFull: () => {},
});

export const useNodeSheet = () => useContext(NodeSheetContext);
