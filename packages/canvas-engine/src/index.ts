/**
 * Canvas Engine - Core rendering and object management
 */

import Konva from "konva";

export interface CanvasConfig {
  width: number;
  height: number;
  container: string | HTMLDivElement;
}

export class CanvasEngine {
  private stage: Konva.Stage;
  private layer: Konva.Layer;

  constructor(config: CanvasConfig) {
    this.stage = new Konva.Stage({
      container:
        typeof config.container === "string"
          ? config.container
          : config.container,
      width: config.width,
      height: config.height,
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);
  }

  public addRect(x: number, y: number, width: number, height: number) {
    const rect = new Konva.Rect({
      x,
      y,
      width,
      height,
      fill: "blue",
      stroke: "black",
      strokeWidth: 2,
    });
    this.layer.add(rect);
    this.layer.draw();
    return rect;
  }

  public addCircle(x: number, y: number, radius: number) {
    const circle = new Konva.Circle({
      x,
      y,
      radius,
      fill: "red",
      stroke: "black",
      strokeWidth: 2,
    });
    this.layer.add(circle);
    this.layer.draw();
    return circle;
  }

  public getStage() {
    return this.stage;
  }

  public getLayer() {
    return this.layer;
  }

  public clear() {
    this.layer.destroyChildren();
    this.layer.draw();
  }
}

export default CanvasEngine;
