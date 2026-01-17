import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the landing header", () => {
  render(<App />);
  expect(screen.getByText(/Welcome to T3Log/i)).toBeInTheDocument();
});
