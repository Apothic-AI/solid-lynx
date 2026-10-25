import { For, Show, createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxNode, LynxPapi, LynxRoot } from "@apothic-ai/solid-lynx";
import { installCapabilityProbe, type CapabilityReport } from "./capability-probe.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface InputEvent {
  detail?: { value?: string };
}

interface Task {
  id: number;
  label: string;
}

type LoadState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; items: string[] }
  | { status: "error"; message: string };

declare const lynx: {
  getEngine(): LynxEngine;
};

const papi = globalThis as unknown as LynxPapi;
const buttonStyle = {
  display: "flex",
  "align-items": "center",
  padding: "8px 12px",
  "background-color": "#1f2937",
  color: "#ffffff",
};

/**
 * Solid's control-flow components are used through these aliases.
 *
 * The JSX types in this package describe an element as a Lynx node, while Solid
 * types its own components for a DOM tree, so `<For>` and `<Show>` do not
 * satisfy the JSX component signature. The aliases keep the same runtime
 * components and give the children callback the element type the renderer
 * actually produces.
 */
function KeyedFor<T>(props: {
  each: readonly T[];
  children: (item: T, index: () => number) => LynxNode;
}): LynxNode {
  return (For as unknown as (source: unknown) => LynxNode)(props);
}

function When(props: { when: boolean; children: () => LynxNode }): LynxNode {
  return (Show as unknown as (source: unknown) => LynxNode)(props);
}

/**
 * A text field bound to a signal.
 *
 * `bindinput` is the one input event this renderer can rely on: `web-core`
 * forwards the field's `input` event as a Lynx `input` event carrying
 * `detail.value`. `bindchange` is not forwarded by that host, so the pattern
 * here reads every keystroke instead of waiting for a change event.
 */
function Field(props: {
  label: string;
  value: string;
  onInput: (value: string) => void;
  onConfirm?: (value: string) => void;
}) {
  return (
    <view id="field">
      <text id="field-label">{props.label}</text>
      <input
        id="field-input"
        type="text"
        value={props.value}
        bindinput={(event: InputEvent) => props.onInput(String(event.detail?.value ?? ""))}
        bindconfirm={(event: InputEvent) => props.onConfirm?.(String(event.detail?.value ?? ""))}
        style={{ padding: "8px", "background-color": "#ffffff", color: "#111827" }}
      />
      <text id="field-echo">{`Echo: ${props.value || "(empty)"}`}</text>
    </view>
  );
}

/**
 * A form built from the supported pieces: bound inputs, a tap-driven submit, and
 * boolean state reflected as an attribute.
 *
 * A native card would normally bind `bindsubmit` on a `<form>`. That event is not
 * in `web-core`'s DOM-to-Lynx event map, so submitting is driven by a tap and the
 * submitted value is read from the signal. The submission path is the part a
 * native run has to re-check.
 */
function FormSection() {
  const [name, setName] = createSignal("");
  const [agreed, setAgreed] = createSignal(false);
  const [submitted, setSubmitted] = createSignal("not submitted");
  const [confirmed, setConfirmed] = createSignal("not confirmed");
  const valid = () => name().trim().length > 0 && agreed();

  return (
    <view id="form-section">
      <text id="form-title">Form</text>
      <Field
        label="Name"
        value={name()}
        onInput={setName}
        onConfirm={value => setConfirmed(`confirmed: ${value.trim()}`)}
      />
      <view
        id="form-agree"
        role="checkbox"
        aria-checked={agreed() ? "true" : "false"}
        bindtap={() => setAgreed(value => !value)}
        style={buttonStyle}
      >
        <text>{agreed() ? "Agreed: yes" : "Agreed: no"}</text>
      </view>
      <view
        id="form-submit"
        role="button"
        disabled={!valid()}
        bindtap={() => setSubmitted(`submitted: ${name().trim()}`)}
        style={{ ...buttonStyle, "background-color": valid() ? "#166534" : "#9ca3af" }}
      >
        <text>Submit</text>
      </view>
      <text id="form-result">{submitted()}</text>
{/* `bindconfirm` is the field's own confirm event, which the web host forwards
          from the Enter key. It is bound separately from the tap-driven submit
          so the two paths stay distinguishable. */}
      <text id="form-confirm">{confirmed()}</text>
    </view>
  );
}

/**
 * A keyed list.
 *
 * `For` keys rows by identity, so reordering moves existing elements instead of
 * recreating them. Nothing here is virtualized: every row is a real child of the
 * list element, which is the documented behaviour for both hosts.
 */
function KeyedListSection() {
  const [tasks, setTasks] = createSignal<Task[]>([
    { id: 1, label: "write the renderer" },
    { id: 2, label: "ship the example" },
    { id: 3, label: "measure on a device" },
  ]);
  let nextId = 4;
  const add = () => {
    const id = nextId++;
    setTasks(current => [...current, { id, label: `task ${id}` }]);
  };
  const removeFirst = () => setTasks(current => current.slice(1));
  const reverse = () => setTasks(current => [...current].reverse());

  return (
    <view id="list-section">
      <text id="list-title">Keyed list</text>
      <view id="list-controls">
        <view id="list-add" role="button" bindtap={add} style={buttonStyle}>
          <text>Add</text>
        </view>
        <view id="list-remove" role="button" bindtap={removeFirst} style={buttonStyle}>
          <text>Remove first</text>
        </view>
        <view id="list-reverse" role="button" bindtap={reverse} style={buttonStyle}>
          <text>Reverse</text>
        </view>
      </view>
      <view id="task-list">
        <KeyedFor each={tasks()}>
          {(task: Task) => (
            <view id={`task-${task.id}`} class="task">
              <text>{task.label}</text>
            </view>
          )}
        </KeyedFor>
      </view>
      <text id="list-count">{`Rows: ${tasks().length}`}</text>
    </view>
  );
}

/**
 * Asynchronous content.
 *
 * The load is a promise resolved outside any reactive scope, and the result
 * arrives through a signal, which is all this renderer needs: there is no
 * `createResource` and no streaming render. The error path is deliberate, so a
 * rejected load is a visible state with a retry rather than a silent no-op.
 */
function AsyncSection() {
  const [state, setState] = createSignal<LoadState>({ status: "idle" });
  const [failNext, setFailNext] = createSignal(false);

  const load = () => {
    setState({ status: "pending" });
    const shouldFail = failNext();
    // A timer rather than an immediate resolution, so the pending state is real.
    setTimeout(() => {
      if (shouldFail) {
        setState({ status: "error", message: "load failed" });
        setFailNext(false);
        return;
      }
      setState({
        status: "ready",
        items: ["alpha", "bravo", "charlie"],
      });
    }, 30);
  };

  return (
    <view id="async-section">
      <text id="async-title">Async content</text>
      <view id="async-load" role="button" bindtap={load} style={buttonStyle}>
        <text>Load</text>
      </view>
      <view
        id="async-fail-next"
        role="checkbox"
        aria-checked={failNext() ? "true" : "false"}
        bindtap={() => setFailNext(value => !value)}
        style={buttonStyle}
      >
        <text>{failNext() ? "Next load fails: yes" : "Next load fails: no"}</text>
      </view>
      <text id="async-state">{`State: ${state().status}`}</text>
      {/* `Show` takes its child as a thunk, so a conditional block is passed as
          a `children` function rather than as JSX children. */}
      <When
        when={state().status === "pending"}
        children={() => <text id="async-pending">Loading...</text>}
      />
      <When
        when={state().status === "ready" && "items" in state()}
        children={() => (
          <view id="async-items">
            <KeyedFor each={(state() as { status: "ready"; items: string[] }).items}>
              {(item: string, index: () => number) => <text>{`${index()}: ${item}`}</text>}
            </KeyedFor>
          </view>
        )}
      />
      <When
        when={state().status === "error"}
        children={() => (
          <view id="async-error">
            <text>{`Error: ${(state() as { status: "error"; message: string }).message}`}</text>
            <view id="async-retry" role="button" bindtap={load} style={buttonStyle}>
              <text>Retry</text>
            </view>
          </view>
        )}
      />
    </view>
  );
}

/** The measured capability findings, rendered so a device run can read them. */
function CapabilitySection(props: { report: CapabilityReport }) {
  return (
    <view id="capability-section">
      <text id="capability-title">{`Host capabilities (${props.report.label})`}</text>
      <KeyedFor each={props.report.findings}>
        {(finding: CapabilityReport["findings"][number]) => (
          <view id={`capability-${finding.capability}`} class="capability">
            <text>{`${finding.capability}: ${finding.status}`}</text>
            <KeyedFor each={finding.observed}>
              {(line: string) => <text class="capability-evidence">{line}</text>}
            </KeyedFor>
          </view>
        )}
      </KeyedFor>
    </view>
  );
}

ensureLynxEnvironmentBasics();

const engine = lynx.getEngine();
let root: LynxRoot | undefined;
let report: CapabilityReport | undefined;

function renderCard(): void {
  if (root) return;

  root = createLynxRoot({ componentId: "0", cssId: 0, transformEventNames: true });
  // The probe runs before the app is mounted so its own tree never mixes with
  // the content below, and so its measurements are not perturbed by it.
  report = installCapabilityProbe();

  root.render(() => (
    <view id="patterns">
      <FormSection />
      <KeyedListSection />
      <AsyncSection />
      <CapabilitySection report={report!} />
    </view>
  ));
}

function destroyCard(): void {
  root?.dispose();
  root = undefined;
}

engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", destroyCard);