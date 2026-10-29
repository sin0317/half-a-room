import { SplatLoader, SplatUtils } from '@manycore/aholo-viewer';
import type { Splat } from '@manycore/aholo-viewer';

/** 支持的 3DGS 格式 → 解析器类型。Aholo Viewer 本身支持 PLY / SPZ / SOG / LCC */
const EXT_TO_TYPE: Record<string, SplatLoader.SplatFileType> = {
  ply: SplatLoader.SplatFileType.PLY,
  spz: SplatLoader.SplatFileType.SPZ,
  splat: SplatLoader.SplatFileType.SPLAT,
  ksplat: SplatLoader.SplatFileType.KSPLAT,
  sog: SplatLoader.SplatFileType.SOG,
  lcc: SplatLoader.SplatFileType.LCC,
};

export type ProgressHandler = (loaded: number, total: number) => void;

/**
 * 打包类型。SPZ / SOG 这类量化格式的解法不止一种，
 * 用 ?pack=compressed|supercompressed 可以切换对照。
 */
export type PackType = 'compressed' | 'supercompressed' | 'raw' | 'sog';

const PACK_TYPES: Record<PackType, number> = {
  raw: 0,
  compressed: 1,
  supercompressed: 2,
  sog: 3,
};

function detectType(url: string): SplatLoader.SplatFileType {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  const type = EXT_TO_TYPE[ext];
  if (type === undefined) {
    throw new Error(`不认识的场景格式 ".${ext}"，支持：${Object.keys(EXT_TO_TYPE).join(' / ')}`);
  }
  return type;
}

/**
 * 载入一个 3DGS 文件并返回可加入场景的 Splat。
 *
 * 走流式解析而不是先 arrayBuffer：几十上百 MB 的扫描件，
 * 一次性读进内存既慢又占内存，流式还能顺带报进度。
 */
export async function loadSplatFile(
  url: string,
  onProgress?: ProgressHandler,
  pack: PackType = 'compressed',
): Promise<Splat> {
  const type = detectType(url);
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} · ${url}`);
  }

  const total = Number(res.headers.get('content-length') ?? 0);

  let data;
  if (res.body) {
    let loaded = 0;
    const counted = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          onProgress?.(loaded, total);
          controller.enqueue(chunk);
        },
      }),
    );
    data = await SplatLoader.parseSplatData(
      type,
      { stream: counted, contentLength: total },
      PACK_TYPES[pack],
    );
  } else {
    const buffer = await res.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    data = await SplatLoader.parseSplatData(
      type,
      new Uint8Array(buffer),
      PACK_TYPES[pack],
    );
  }

  return SplatUtils.createSplat(data);
}
