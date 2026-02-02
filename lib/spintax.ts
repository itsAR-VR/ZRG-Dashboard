export type SpintaxExpandResult = { ok: true; output: string } | { ok: false; error: string };
export type SpintaxValidationResult = { ok: true } | { ok: false; error: string };

export type SpintaxChooserContext = {
  seed: string;
  groupIndex: number;
  optionCount: number;
  options: string[];
};

export type SpintaxExpandOptions = {
  seed?: string;
  chooser?: (ctx: SpintaxChooserContext) => number;
};

export const SPINTAX_ERRORS = {
  unclosedGroup: "Spintax group is not closed (missing ]])",
  nestedGroup: "Spintax nesting is not supported",
  emptyOption: "Spintax option cannot be empty",
} as const;

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeChoice(choice: number, optionCount: number): number {
  if (!Number.isFinite(choice) || optionCount <= 0) return 0;
  const index = Math.floor(choice);
  const mod = ((index % optionCount) + optionCount) % optionCount;
  return mod;
}

function defaultChooser(ctx: SpintaxChooserContext): number {
  const hash = fnv1a32(`${ctx.seed}:${ctx.groupIndex}`);
  return hash % ctx.optionCount;
}

type ParseGroupResult =
  | { ok: true; options: string[]; endIndex: number }
  | { ok: false; error: string };

function parseGroup(input: string, startIndex: number): ParseGroupResult {
  const options: string[] = [];
  let current = "";
  let index = startIndex;

  while (index < input.length) {
    const char = input[index];

    if (char === "\\" && index + 1 < input.length) {
      current += input[index + 1];
      index += 2;
      continue;
    }

    if (char === "[" && input[index + 1] === "[") {
      return { ok: false, error: SPINTAX_ERRORS.nestedGroup };
    }

    if (char === "]" && input[index + 1] === "]") {
      options.push(current);
      const invalid = options.some((opt) => opt.trim().length === 0);
      if (invalid) return { ok: false, error: SPINTAX_ERRORS.emptyOption };
      return { ok: true, options, endIndex: index + 2 };
    }

    if (char === "|") {
      options.push(current);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  return { ok: false, error: SPINTAX_ERRORS.unclosedGroup };
}

export function expandSpintax(input: string, options?: SpintaxExpandOptions): SpintaxExpandResult {
  if (!input.includes("[[")) return { ok: true, output: input };

  const seed = options?.seed ?? "";
  const chooser = options?.chooser ?? defaultChooser;

  let output = "";
  let index = 0;
  let groupIndex = 0;

  while (index < input.length) {
    const start = input.indexOf("[[", index);
    if (start === -1) {
      output += input.slice(index);
      break;
    }

    output += input.slice(index, start);

    const parsed = parseGroup(input, start + 2);
    if (!parsed.ok) return parsed;

    const optionIndex = normalizeChoice(
      chooser({
        seed,
        groupIndex,
        optionCount: parsed.options.length,
        options: parsed.options,
      }),
      parsed.options.length
    );

    output += parsed.options[optionIndex] ?? "";
    groupIndex += 1;
    index = parsed.endIndex;
  }

  return { ok: true, output };
}

export function validateSpintax(input: string): SpintaxValidationResult {
  if (!input.includes("[[")) return { ok: true };
  const result = expandSpintax(input, { seed: "validate", chooser: () => 0 });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
