# tsx-text-lint
TS document jax text/attr lint plugin.

2025.07.22
- 支持了AI PR 分析文案。


如果需要忽略检查 

    JsxText中请在文案上添加 `/* @text-lint ignore */` 注释。
    ```tsx
    <Text>
        {/* @text-lint ignore */}
        campaign messages per client within
    </Text>
    ```
    attribute中请在文案上添加 `// @text-lint ignore` 注释。
    ```tsx
    <div 
        // @text-lint ignore
        title="campaign messages per client within">
    </div>
    ```
    代码块忽略检查请分别在首和尾添加 `/* @text-lint ignore start */` 和 `/* @text-lint ignore end */` 注释。
    ```tsx
    /* @text-lint ignore start */
    ...your code...
    /* @text-lint ignore end */
    ```