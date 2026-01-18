import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { AppStateProvider } from "./contexts/AppStateContext";
import AuthCallbackHandler from "./components/AuthCallbackHandler";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AppStateProvider>
      <BrowserRouter>
        <AuthProvider>
          <AuthCallbackHandler>
            <App />
          </AuthCallbackHandler>
        </AuthProvider>
      </BrowserRouter>
    </AppStateProvider>
  </React.StrictMode>
);
