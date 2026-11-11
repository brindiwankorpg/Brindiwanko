/**
 * @file Quarantine of the scripts that come from imported files.
 *
 * Event commands can carry code run on the server (in the sandbox): the
 * "script" command, conditional branches on a script, and variables set from
 * a script. Scripts written in the editor are the administrators' own; those
 * found in an imported project or database file are not: they are kept, but
 * marked `quarantined` and do nothing (a script branch is false, a script
 * operand is 0) until an administrator has read their code and turned them on.
 * The mark follows the command when it is copied, moved or edited.
 */
import { BranchType, Cmd, type EventCommand } from './events.js';

/** Tells whether a command carries code run by the sandbox. */
export function isScriptCommand(cmd: EventCommand): boolean {
  // Read like the interpreter reads them (`"12"` and `12.5` are branch type 12): an imported file must not
  // slip a script past the quarantine by writing its type as a string.
  const int = (v: unknown) => Math.trunc(Number(v)) || 0;
  if (cmd.code === Cmd.Script) return true;
  if (cmd.code === Cmd.If) return int(cmd.parameters[0]) === BranchType.Script;
  // Control variables with a script operand (operand type 4).
  return cmd.code === Cmd.ControlVariables && int(cmd.parameters[3]) === 4;
}

/** Tells whether a command is a script waiting for an administrator's approval. */
export function isQuarantined(cmd: EventCommand): boolean {
  return cmd.quarantined === true && isScriptCommand(cmd);
}

/**
 * Code run by the script command at `index` (a script and its continuation lines, a script
 * condition, a script operand).
 */
export function scriptSource(list: readonly EventCommand[], index: number): string {
  const c = list[index];
  if (!c) return '';
  if (c.code === Cmd.Script) {
    const lines = [String(c.parameters[0] ?? '')];
    for (let i = index + 1; list[i]?.code === Cmd.ScriptLine && list[i]!.indent === c.indent; i++) lines.push(String(list[i]!.parameters[0] ?? ''));
    return lines.join('\n');
  }
  return String(c.parameters[c.code === Cmd.If ? 1 : 4] ?? '');
}

/**
 * Puts every script command of a list in quarantine (imported content).
 * @returns The number of scripts marked.
 */
export function quarantineList(list: EventCommand[]): number {
  let count = 0;
  for (const c of list) {
    if (!isScriptCommand(c)) continue;
    c.quarantined = true;
    count++;
  }
  return count;
}

/** Scripts of a list waiting for approval, with their code. */
export function quarantinedScripts(list: readonly EventCommand[]): { index: number; code: string }[] {
  return list.flatMap((c, index) => (isQuarantined(c) ? [{ index, code: scriptSource(list, index) }] : []));
}

/**
 * Turns on a script of a list, if its code is still the one the administrator read.
 * @returns `true` when the script was approved.
 */
export function approveScript(list: EventCommand[], index: number, code: string): boolean {
  const c = list[index];
  if (!c || !isQuarantined(c) || scriptSource(list, index) !== code) return false;
  delete c.quarantined;
  return true;
}

/**
 * Keeps the quarantine of a block that was edited: when the block held a script waiting for
 * approval, the scripts of its new version wait too (editing is not approving).
 * @param before - The block before the edit.
 * @param after - Its new version (modified and returned).
 */
export function keepQuarantine(before: readonly EventCommand[], after: EventCommand[]): EventCommand[] {
  if (before.some(isQuarantined)) quarantineList(after);
  return after;
}
