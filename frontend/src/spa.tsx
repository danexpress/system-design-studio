import "./lib/error-capture";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { getSpaRouter } from "./spa-router";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={getSpaRouter()} />
  </StrictMode>,
);
