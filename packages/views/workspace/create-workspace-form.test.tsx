import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@multica/core/i18n/react";
import { configStore } from "@multica/core/config";
import enCommon from "../locales/en/common.json";
import enWorkspace from "../locales/en/workspace.json";
import { CreateWorkspaceForm } from "./create-workspace-form";

const TEST_RESOURCES = {
  en: { common: enCommon, workspace: enWorkspace },
};

const mockMutate = vi.fn();
const mockCopyMutate = vi.fn();
vi.mock("@multica/core/workspace/mutations", () => ({
  useCreateWorkspace: () => ({ mutate: mockMutate, isPending: false }),
  useCopyWorkspace: () => ({ mutate: mockCopyMutate, isPending: false }),
}));

vi.mock("@multica/core/workspace/queries", () => ({
  workspaceListOptions: () => ({ queryKey: ["workspaces"] }),
}));

function I18nWrapper({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      {children}
    </I18nProvider>
  );
}

function renderForm(onSuccess = vi.fn()) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CreateWorkspaceForm onSuccess={onSuccess} />
    </QueryClientProvider>,
    { wrapper: I18nWrapper },
  );
}

describe("CreateWorkspaceForm", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockCopyMutate.mockReset();
    configStore.setState({ daemonAppUrl: "" });
  });

  it("shows the brand host as the URL prefix when no app URL is configured", () => {
    renderForm();
    expect(screen.getByText("multica.ai/")).toBeInTheDocument();
  });

  it("shows the deployment host as the URL prefix for self-hosted instances", () => {
    configStore.setState({ daemonAppUrl: "https://multica.example.com" });
    renderForm();
    expect(screen.getByText("multica.example.com/")).toBeInTheDocument();
    expect(screen.queryByText("multica.ai/")).not.toBeInTheDocument();
  });

  it("auto-generates slug from name until user edits slug", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Acme Corp" },
    });
    expect(screen.getByDisplayValue("acme-corp")).toBeInTheDocument();
  });

  it("stops auto-generating slug once user edits slug directly", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace url/i), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Different Name" },
    });
    expect(screen.getByDisplayValue("custom")).toBeInTheDocument();
  });

  it("calls onSuccess with the created workspace", async () => {
    const onSuccess = vi.fn();
    mockMutate.mockImplementation((_args, opts) => {
      opts?.onSuccess?.({ id: "ws-1", slug: "acme", name: "Acme" });
    });
    renderForm(onSuccess);
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "acme" }),
      ),
    );
  });

  it("shows slug-conflict error inline on 409", async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts?.onError?.({ status: 409 });
    });
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Taken" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));
    await waitFor(() =>
      expect(screen.getByText(/already taken/i)).toBeInTheDocument(),
    );
  });

  it("disables submit when slug has invalid format", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Valid Name" },
    });
    fireEvent.change(screen.getByLabelText(/workspace url/i), {
      target: { value: "Invalid Slug!" },
    });
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeDisabled();
  });

  it("disables submit when slug is reserved", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Valid Name" },
    });
    fireEvent.change(screen.getByLabelText(/workspace url/i), {
      target: { value: "admin" },
    });
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeDisabled();
    expect(screen.getByText(/reserved and cannot be used/i)).toBeInTheDocument();
  });

  it("reveals the source-workspace picker and copy checklist when copy mode is toggled on", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Acme Corp" },
    });
    expect(screen.queryByText("Source workspace")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /copy from existing workspace/i }));

    expect(screen.getByText("Source workspace")).toBeInTheDocument();
    expect(screen.getByText("agents")).toBeInTheDocument();
    expect(screen.getByText("wiki")).toBeInTheDocument();
    // Copy mode is on but no source workspace is chosen yet — submit stays gated
    // (copyModeReady in create-workspace-form.tsx).
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeDisabled();
  });

  it("re-enables submit when copy mode is turned back off", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Acme Corp" },
    });

    const copyModeCheckbox = screen.getByRole("checkbox", { name: /copy from existing workspace/i });
    fireEvent.click(copyModeCheckbox);
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeDisabled();

    fireEvent.click(copyModeCheckbox);
    expect(screen.queryByText("Source workspace")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).not.toBeDisabled();
  });
});
