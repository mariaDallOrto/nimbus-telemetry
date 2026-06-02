import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Register a DOM before any @testing-library module evaluates. Kept in its own
// preload file because ES imports hoist — registration must fully run before
// the setup file imports @testing-library, which binds queries to document.
GlobalRegistrator.register();
