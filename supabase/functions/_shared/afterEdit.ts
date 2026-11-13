// After the editor AI wrote an event again (event-agent "edit"): what may be written. Read from the row
// as it is NOW — a person may have corrected the text, the secondary types or the pin while the AI was
// writing, and those flags must be kept (merged) and obeyed. No imports, so the unit tests load it.

interface Row {
  ai_suggestions?: Record<string, unknown> | null;
  coordinates_manually_corrected?: boolean | null;
}

export function afterEdit(fresh: Row | null, add: Record<string, unknown>): {
  ai: Record<string, unknown>;
  writeText: boolean;
  writeSecondary: boolean;
  writePlaces: boolean;
} {
  const now = (fresh?.ai_suggestions ?? {}) as Record<string, unknown>;
  return {
    ai: { ...now, ...add },
    writeText: !now.manual_text,
    writeSecondary: !now.manual_secondary && !now.split_from && !now.split_into,
    writePlaces: !fresh?.coordinates_manually_corrected,
  };
}
