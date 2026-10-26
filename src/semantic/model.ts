/* Pinned multilingual-e5-small (int8 ONNX, Xenova export, MIT).
   Query/passage prefixes, mean pooling and L2 normalisation are part of the
   retrieval contract. Symmetric query prefixes reduce Turkish-to-English
   recall, so messages retain the passage prefix. Files are served from this
   app's origin and verified against SHA-256 before use. */
export interface ModelFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelSpec {
  readonly repo: string;
  readonly revision: string;
  readonly dtype: "int8";
  readonly pooling: "mean";
  readonly dim: number;
  readonly queryPrefix: string;
  readonly passagePrefix: string;
  /** How much a message sharing the question's informative words gains over its similarity (hybrid.ts).
      A model whose similarities are compressed needs a small weight, or shared words override meaning. */
  readonly lexicalWeight: number;
  /** Nearest messages below this similarity are not considered related by meaning. Set at the 2nd percentile of
      correct messages' similarity on the development split: for this model no threshold separates "nothing
      relevant" (unrelated questions score as high as related ones), so it only drops clear noise. */
  readonly minSimilarity: number;
  /** Characters of message text embedded; longer messages are cut (the model reads at most 512 tokens). */
  readonly maxChars: number;
  readonly files: readonly ModelFile[];
}

export const E5_SMALL: ModelSpec = {
  repo: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  dtype: "int8",
  pooling: "mean",
  dim: 384,
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
  lexicalWeight: 0.05,
  minSimilarity: 0.77,
  maxChars: 1000,
  files: [
    { path: "config.json", bytes: 658, sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1" },
    { path: "tokenizer.json", bytes: 17_082_730, sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    { path: "tokenizer_config.json", bytes: 443, sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
    { path: "special_tokens_map.json", bytes: 167, sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7" },
    { path: "onnx/model_int8.onnx", bytes: 118_054_593, sha256: "4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c" },
  ],
};

/** Names the verified model files on this device; unchanged by text preparation, so files are never fetched again for it. */
export const modelKey = (spec: ModelSpec) => `${spec.repo.replace("/", "--")}@${spec.revision.slice(0, 12)}-${spec.dtype}-c${spec.maxChars}`;
/** Identifies vectors made by this model and text preparation; any change invalidates stored indexes (they are rebuilt, never reused). */
export const indexKey = (spec: ModelSpec) => `${modelKey(spec)}${spec.passagePrefix === "passage: " ? "" : `-p${spec.passagePrefix.replace(/\W/g, "")}`}`;
export const modelBytes = (spec: ModelSpec) => spec.files.reduce((n, f) => n + f.bytes, 0);
