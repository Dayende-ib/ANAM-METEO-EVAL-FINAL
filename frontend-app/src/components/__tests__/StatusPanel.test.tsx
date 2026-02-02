import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorPanel, LoadingPanel } from "../StatusPanel";

describe("StatusPanel", () => {
  it("renders loading message", () => {
    render(<LoadingPanel message="Loading data" />);
    expect(screen.getByText("Loading data")).toBeInTheDocument();
  });

  it("renders error message", () => {
    render(<ErrorPanel message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
