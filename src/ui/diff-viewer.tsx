// Full-featured diff viewer for workstreams, built on critique's DiffView component.
// Layout matches: header (← file +N-N →), scrollable diff, footer (prev/next/keybindings),
// optional workstream tabs. Supports syntax highlighting, theme picker, file picker,
// split/unified view, vim-style scroll, and mouse.

import "critique/dist/patch-terminal-dimensions.js";

import * as React from "react";
import {
  createCliRenderer,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollBoxRenderable,
} from "@opentuah/core";
import {
  createRoot,
  useKeyboard,
  useTerminalDimensions,
  useRenderer,
} from "@opentuah/react";
import { parsePatch, formatPatch } from "diff";
import { DiffView } from "critique/dist/components/diff-view.js";
import {
  processFiles,
  parseGitDiffFiles,
  stripSubmoduleHeaders,
  getFileName,
  getOldFileName,
  countChanges,
  getViewMode,
  detectFiletype,
  type ParsedFile,
} from "critique/dist/diff-utils.js";
import { getResolvedTheme, themeNames, rgbaToHex } from "critique/dist/themes.js";
import { useAppStore } from "critique/dist/store.js";
import Dropdown from "critique/dist/dropdown.js";
import parsersConfig from "critique/dist/parsers-config.js";

let parsersRegistered = false;

type ProcessedFile = ParsedFile & { rawDiff: string };

class ScrollAccel {
  private inner: MacOSScrollAccel;
  public multiplier = 1;
  constructor() { this.inner = new MacOSScrollAccel({ A: 1.5, maxMultiplier: 10 }); }
  tick(delta: number) { return this.inner.tick(delta) * this.multiplier; }
  reset() { this.inner.reset(); }
}

interface DiffAppProps {
  files: ProcessedFile[];
  currentWorkstream?: string;
  workstreams?: string[];
}

function DiffApp({ files, currentWorkstream, workstreams }: DiffAppProps): React.ReactElement {
  const [fileIndex, setFileIndex] = React.useState(0);
  const [showFilePicker, setShowFilePicker] = React.useState(false);
  const [showThemePicker, setShowThemePicker] = React.useState(false);
  const [previewTheme, setPreviewTheme] = React.useState<string | null>(null);
  const [viewOverride, setViewOverride] = React.useState<"split" | "unified" | null>(null);
  const [scrollAccel] = React.useState(() => new ScrollAccel());
  const scrollboxRef = React.useRef<ScrollBoxRenderable | null>(null);
  const lastKeyRef = React.useRef<{ key: string; time: number } | null>(null);
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();

  const themeName = useAppStore((s: { themeName: string }) => s.themeName);
  const activeTheme = previewTheme ?? themeName;
  const resolvedTheme = getResolvedTheme(activeTheme);
  const bg = resolvedTheme.background;
  const textColor = rgbaToHex(resolvedTheme.text);
  const mutedColor = rgbaToHex(resolvedTheme.textMuted);

  const file = files[fileIndex];
  const hasPrev = fileIndex > 0;
  const hasNext = fileIndex < files.length - 1;
  const arrowColor = (active: boolean) => active ? textColor : mutedColor;

  useKeyboard((key: any) => {
    if (showFilePicker || showThemePicker) {
      if (key.name === "escape") {
        setShowFilePicker(false);
        setShowThemePicker(false);
        setPreviewTheme(null);
      }
      return;
    }

    if (key.name === "escape" || key.name === "q") { renderer.destroy(); return; }
    if (key.ctrl && key.name === "z") { renderer.console.toggle(); return; }
    if (key.ctrl && key.name === "p") { setShowFilePicker(true); return; }
    if (key.name === "t") { setShowThemePicker(true); return; }
    if (key.name === "s") {
      setViewOverride((v) => v === "split" ? "unified" : v === "unified" ? null : "split");
      return;
    }

    const scrollToTop = () => scrollboxRef.current?.scrollTo(0);

    if (key.name === "right") {
      if (hasNext) { setFileIndex((i) => i + 1); scrollToTop(); }
      return;
    }
    if (key.name === "left") {
      if (hasPrev) { setFileIndex((i) => i - 1); scrollToTop(); }
      return;
    }

    const sb = scrollboxRef.current;
    if (sb) {
      if (key.name === "g" && key.shift) { sb.scrollBy(1, "content"); return; }
      if (key.name === "g" && !key.shift && !key.ctrl) {
        const now = Date.now();
        if (lastKeyRef.current?.key === "g" && now - lastKeyRef.current.time < 300) {
          sb.scrollTo(0); lastKeyRef.current = null;
        } else {
          lastKeyRef.current = { key: "g", time: now };
        }
        return;
      }
      if (key.ctrl && key.name === "d") { sb.scrollBy(0.5, "viewport"); return; }
      if (key.ctrl && key.name === "u") { sb.scrollBy(-0.5, "viewport"); return; }
    }

    if (key.option) {
      scrollAccel.multiplier = key.eventType === "release" ? 1 : 10;
    }
  });

  if (files.length === 0) {
    return (
      <box style={{ padding: 1, backgroundColor: bg }}>
        <text fg={textColor}>No changes to display</text>
      </box>
    );
  }

  const fileName = file ? getFileName(file) : "";
  const oldFileName = file ? getOldFileName(file) : undefined;
  const filetype = fileName ? detectFiletype(fileName) : undefined;
  const { additions, deletions } = file ? countChanges(file.hunks) : { additions: 0, deletions: 0 };
  const viewMode = viewOverride ?? getViewMode(additions, deletions, width);

  const fileOptions = files.map((f, idx) => ({
    title: getFileName(f),
    value: String(idx),
    keywords: getFileName(f).split("/"),
  }));

  const themeOpts = themeNames.map((n: string) => ({ title: n, value: n }));

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: bg }}>

      {/* Overlays */}
      {showThemePicker && (
        <box style={{ flexShrink: 0, maxHeight: 15 }}>
          <Dropdown
            tooltip="Select theme"
            options={themeOpts}
            selectedValues={[themeName]}
            onChange={(v: string) => {
              useAppStore.setState({ themeName: v });
              setShowThemePicker(false);
              setPreviewTheme(null);
            }}
            onFocus={(v: string) => setPreviewTheme(v)}
            onEscape={() => { setShowThemePicker(false); setPreviewTheme(null); }}
            placeholder="Search themes..."
            itemsPerPage={6}
            theme={resolvedTheme}
          />
        </box>
      )}
      {showFilePicker && (
        <box style={{ flexShrink: 0, maxHeight: 15 }}>
          <Dropdown
            tooltip="Select file"
            options={fileOptions}
            selectedValues={[String(fileIndex)]}
            onChange={(v: string) => {
              setFileIndex(parseInt(v, 10));
              scrollboxRef.current?.scrollTo(0);
              setShowFilePicker(false);
            }}
            onEscape={() => setShowFilePicker(false)}
            placeholder="Search files..."
            itemsPerPage={6}
            theme={resolvedTheme}
          />
        </box>
      )}

      {/* Header: ← filename +N -N → */}
      {!showFilePicker && !showThemePicker && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
          }}
        >
          <text fg={arrowColor(hasPrev)}>← </text>
          <box style={{ flexGrow: 1, flexDirection: "row", justifyContent: "center" }}>
            {oldFileName ? (
              <>
                <text fg={mutedColor}>{oldFileName} → </text>
                <text fg={textColor}><b>{fileName}</b></text>
              </>
            ) : (
              <text fg={textColor}><b>{fileName}</b></text>
            )}
            <text fg="#2d8a47"> +{additions}</text>
            <text fg="#c53b53">-{deletions}</text>
          </box>
          <text fg={arrowColor(hasNext)}> →</text>
        </box>
      )}

      {/* Diff content */}
      <scrollbox
        ref={scrollboxRef}
        scrollY
        scrollAcceleration={scrollAccel}
        style={{
          flexGrow: 1,
          flexShrink: 1,
          rootOptions: { backgroundColor: bg, border: false },
          contentOptions: { minHeight: 0 },
          scrollbarOptions: {
            showArrows: false,
            trackOptions: { foregroundColor: mutedColor, backgroundColor: bg },
          },
        }}
        focused={!showFilePicker && !showThemePicker}
      >
        {file && (
          <DiffView
            diff={file.rawDiff ?? ""}
            view={viewMode}
            filetype={filetype}
            themeName={activeTheme}
          />
        )}
      </scrollbox>

      {/* Footer: ← prev        [q quit  ctrl p files  s split  t theme]        next → */}
      {!showFilePicker && !showThemePicker && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            paddingTop: 1,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          {/* Left: prev */}
          <box style={{ flexGrow: 1, flexBasis: 0, flexDirection: "row", alignItems: "center" }}>
            <text fg={arrowColor(hasPrev)}>←</text>
            <text fg={hasPrev ? textColor : mutedColor}> prev</text>
          </box>

          {/* Center: keybindings */}
          <box style={{ flexDirection: "row", alignItems: "center" }}>
            <text fg={textColor}>q</text>
            <text fg={mutedColor}> quit  </text>
            <text fg={textColor}>ctrl p</text>
            <text fg={mutedColor}> files ({fileIndex + 1}/{files.length})  </text>
            <text fg={textColor}>s</text>
            <text fg={mutedColor}> {viewMode}  </text>
            <text fg={textColor}>t</text>
            <text fg={mutedColor}> theme</text>
          </box>

          {/* Right: next */}
          <box style={{ flexGrow: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
            <text fg={hasNext ? textColor : mutedColor}>next </text>
            <text fg={arrowColor(hasNext)}>→</text>
          </box>
        </box>
      )}

      {/* Workstream tabs */}
      {workstreams && workstreams.length > 1 && !showFilePicker && !showThemePicker && (
        <box
          style={{
            flexShrink: 0,
            flexDirection: "row",
            justifyContent: "flex-end",
            paddingLeft: 1,
            paddingRight: 1,
            paddingBottom: 1,
          }}
        >
          {workstreams.map((ws, i) => (
            <React.Fragment key={ws}>
              {i > 0 && <text fg={mutedColor}> | </text>}
              {ws === currentWorkstream
                ? <text fg={textColor}><b>{ws}</b></text>
                : <text fg={mutedColor}>{ws}</text>
              }
            </React.Fragment>
          ))}
        </box>
      )}
    </box>
  );
}

export interface DiffViewerOptions {
  workstreams?: string[];
}

export async function openDiffViewer(
  name: string,
  rawDiff: string,
  options?: DiffViewerOptions,
): Promise<void> {
  if (!parsersRegistered) {
    addDefaultParsers(parsersConfig.parsers);
    parsersRegistered = true;
  }

  const files = processFiles(
    parseGitDiffFiles(stripSubmoduleHeaders(rawDiff), parsePatch),
    formatPatch,
  ) as ProcessedFile[];

  return new Promise<void>(async (resolve) => {
    const renderer = await createCliRenderer({
      onDestroy() { resolve(); },
      exitOnCtrlC: true,
      useMouse: true,
      enableMouseMovement: true,
    });

    createRoot(renderer).render(
      <DiffApp
        files={files}
        currentWorkstream={name}
        workstreams={options?.workstreams}
      />
    );
  });
}
