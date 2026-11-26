import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationLayer } from "../AnnotationLayer";

describe("AnnotationLayer 颜料盘显隐", () => {
  it("mode=draw 时显示三色颜料圆点与清除按钮", () => {
    const html = renderToStaticMarkup(
      <AnnotationLayer width={600} height={400} time={0} mode="draw" strokes={[]} onChange={() => {}} />,
    );
    const colorMatches = html.match(/class="annotation-color"/g) ?? [];
    expect(colorMatches).toHaveLength(3);
    expect(html).toContain('class="annotation-clear"');
  });

  it("切到 mode=laser（临时标注）时不显示三色颜料圆点", () => {
    const html = renderToStaticMarkup(
      <AnnotationLayer width={600} height={400} time={0} mode="laser" strokes={[]} onChange={() => {}} />,
    );
    const colorMatches = html.match(/class="annotation-color"/g) ?? [];
    expect(colorMatches).toHaveLength(0);
    expect(html).not.toContain('class="annotation-clear"');
  });

  it("切到 mode=off 时不显示三色颜料圆点", () => {
    const html = renderToStaticMarkup(
      <AnnotationLayer width={600} height={400} time={0} mode="off" strokes={[]} onChange={() => {}} />,
    );
    const colorMatches = html.match(/class="annotation-color"/g) ?? [];
    expect(colorMatches).toHaveLength(0);
    expect(html).not.toContain('class="annotation-clear"');
  });
});
