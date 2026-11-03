import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { MessageDialogProvider } from "./components/MessageDialog";
import { MyNumberUnlockProvider } from "./features/mynumber/MyNumberUnlock";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <MessageDialogProvider>
        <MyNumberUnlockProvider>
          <App />
        </MyNumberUnlockProvider>
      </MessageDialogProvider>
    </ToastProvider>
  </React.StrictMode>,
);
