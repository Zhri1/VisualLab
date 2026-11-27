import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./ui/styles/global.css";
import { installButtonPressFeel } from "./ui/interactions/buttonPress";

installButtonPressFeel();

const el = document.getElementById("root");
if (!el) throw new Error("#root 未找到");

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
