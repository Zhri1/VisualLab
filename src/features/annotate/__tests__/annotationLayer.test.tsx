import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ANNOTATION_COLOR_OPTIONS, AnnotationLayer, AnnotationPalette } from "../AnnotationLayer";

describe("AnnotationLayer 与画布外 AnnotationPalette 颜料盘显隐", () => {
  it("AnnotationLayer 不再在画布右上角叠加三色颜料圆点或清除按钮", () => {
    const html = renderToStaticMarkup(
      <AnnotationLayer width={600} height={400} time={0} mode="draw" strokes={[]} onChange={() => {}} />,
    );
    expect(html.match(/class="annotation-color"/g) ?? []).toHaveLength(0);
    expect(html).not.toContain('class="annotation-clear"');
  });

  it("AnnotationPalette 在 mode=draw 时显示三色颜料圆点与清除按钮，保留选中态", () => {
    const html = renderToStaticMarkup(
      <AnnotationPalette
        mode="draw"
        color={ANNOTATION_COLOR_OPTIONS[1].value}
        onColorChange={() => {}}
        onClear={() => {}}
      />,
    );
    const colorMatches = html.match(/class="annotation-color"/g) ?? [];
    expect(colorMatches).toHaveLength(3);
    expect(html).toContain('aria-label="蓝色" aria-pressed="true"');
    expect(html).toContain('class="annotation-clear"');
  });

  it("AnnotationPalette 在 mode=laser（临时标注）或 mode=off 时不显示", () => {
    const laserHtml = renderToStaticMarkup(
      <AnnotationPalette
        mode="laser"
        color={ANNOTATION_COLOR_OPTIONS[0].value}
        onColorChange={() => {}}
        onClear={() => {}}
      />,
    );
    const offHtml = renderToStaticMarkup(
      <AnnotationPalette
        mode="off"
        color={ANNOTATION_COLOR_OPTIONS[0].value}
        onColorChange={() => {}}
        onClear={() => {}}
      />,
    );
    expect(laserHtml).toBe("");
    expect(offHtml).toBe("");
  });
});
