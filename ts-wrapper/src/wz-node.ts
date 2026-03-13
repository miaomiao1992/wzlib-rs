/**
 * WZ node types — mirrors the Rust WzPropertyType enum.
 */
export enum WzNodeType {
  Null = 'Null',
  Short = 'Short',
  Int = 'Int',
  Long = 'Long',
  Float = 'Float',
  Double = 'Double',
  String = 'String',
  SubProperty = 'SubProperty',
  Canvas = 'Canvas',
  Vector = 'Vector',
  Convex = 'Convex',
  Sound = 'Sound',
  Uol = 'UOL',
  Lua = 'Lua',
  RawData = 'RawData',
  Video = 'Video',
  Directory = 'Directory',
  Image = 'Image',
}

/** A node in the WZ object tree — analogous to a DOM node for WZ files. */
export class WzNode {
  readonly name: string;
  readonly type: WzNodeType;
  private _children: Map<string, WzNode> = new Map();
  private _value: unknown;

  pixelData?: Uint8Array;
  width?: number;
  height?: number;
  audioData?: Uint8Array;
  audioDurationMs?: number;
  videoData?: Uint8Array;
  videoType?: number;

  constructor(name: string, type: WzNodeType, value?: unknown) {
    this.name = name;
    this.type = type;
    this._value = value;
  }

  get value(): unknown {
    return this._value;
  }

  get intValue(): number | undefined {
    if (typeof this._value === 'number') return this._value;
    return undefined;
  }

  get stringValue(): string | undefined {
    if (typeof this._value === 'string') return this._value;
    return undefined;
  }

  get vectorValue(): [number, number] | undefined {
    if (this.type === WzNodeType.Vector && Array.isArray(this._value)) {
      return this._value as [number, number];
    }
    return undefined;
  }

  get childCount(): number {
    return this._children.size;
  }

  addChild(node: WzNode): void {
    this._children.set(node.name, node);
  }

  getChild(name: string): WzNode | undefined {
    return this._children.get(name);
  }

  get children(): WzNode[] {
    return Array.from(this._children.values());
  }

  get childNames(): string[] {
    return Array.from(this._children.keys());
  }

  /**
   * Resolve a path like "mob/100100/info/speed".
   * Supports "/" as separator.
   */
  resolve(path: string): WzNode | undefined {
    const parts = path.split('/').filter(Boolean);
    let current: WzNode | undefined = this;
    for (const part of parts) {
      current = current?.getChild(part);
      if (!current) return undefined;
    }
    return current;
  }

  /**
   * Walk all descendants depth-first.
   * The callback receives each node and its full path.
   */
  walk(callback: (node: WzNode, path: string) => void, parentPath = ''): void {
    const path = parentPath ? `${parentPath}/${this.name}` : this.name;
    callback(this, path);
    for (const child of this._children.values()) {
      child.walk(callback, path);
    }
  }

  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      name: this.name,
      type: this.type,
    };
    if (this._value !== undefined) obj.value = this._value;
    if (this.width !== undefined) obj.width = this.width;
    if (this.height !== undefined) obj.height = this.height;
    if (this._children.size > 0) {
      obj.children = Object.fromEntries(
        Array.from(this._children.entries()).map(([k, v]) => [k, v.toJSON()]),
      );
    }
    return obj;
  }
}
