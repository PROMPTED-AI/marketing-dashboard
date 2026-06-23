import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { ThemeProvider } from "./lib/ThemeProvider.jsx";
import { MeProvider } from "./lib/useMe.jsx";
import { PeriodProvider } from "./lib/PeriodProvider.jsx";
import "./theme.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <MeProvider>
        <PeriodProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </PeriodProvider>
      </MeProvider>
    </ThemeProvider>
  </React.StrictMode>
);
