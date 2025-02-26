export const config = {
  // 需要检查的 JSX 属性
  targetAttributes: [
    "placeholder",
    "title",
    "alt",
    "label",
    "aria-label",
    "description",
    "content",
    "tooltip",
    "aria-description",
  ],
  // 需要忽略的 JSX 属性
  ignoreAttributes: [
    "className",
    "class",
    "style",
    "id",
    "name",
    "type",
    "key",
    "data-testid",
    "data-*", // 所有 data- 属性
  ],
};
