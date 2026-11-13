// Browser-safe encoding choices. New revisions get new IDs; never redefine an existing ID.
export const ENCODING_PRESETS = [
  {
    id: "data-saver-v1",
    name: "Tiết kiệm dữ liệu",
    maxHeight: 480,
    description: "H.264/AAC, tối đa 480p; ưu tiên đường truyền chậm.",
  },
  {
    id: "balanced-720p-v1",
    name: "Cân bằng 720p",
    maxHeight: 720,
    description: "H.264/AAC, tối đa 720p; mặc định cho video mới.",
  },
  {
    id: "balanced-1080p-v1",
    name: "Full HD 1080p",
    maxHeight: 1080,
    description: "H.264/AAC, tối đa 1080p khi nguồn đủ độ phân giải.",
  },
] as const;
export type EncodingPresetId = (typeof ENCODING_PRESETS)[number]["id"];
export const DEFAULT_ENCODING_PRESET: EncodingPresetId = "balanced-720p-v1";
