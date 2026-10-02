import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { MessageDialogProvider } from "./components/MessageDialog";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <MessageDialogProvider>
        <App />
      </MessageDialogProvider>
    </ToastProvider>
  </React.StrictMode>,
);
