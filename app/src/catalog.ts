/**
 * 图鉴层：把「想起来的那些东西」列成可点的索引。
 *
 * 它不是替代场景的第二套东西，而是给场景做的目录——
 * 点一条，镜头就飞到那件东西前面，同时展开当时那句话。
 * 讲不出来的地方不会出现在这里，它就那样空着。
 */

export interface CatalogItem {
  id: string;
  /** 物件名 */
  name: string;
  /** 主人当时说的那句话 */
  memory: string;
  /** 补充：这件东西后来怎么样了 */
  note?: string;
  /** 缩略图（可选） */
  thumb?: string;
  /** 该物件所在位置，镜头飞过去的目标点 */
  target: [number, number, number];
  /** 观察该物件的机位 */
  eye: [number, number, number];
  /** 生成出来的网格（glb 相对路径），会与 3DGS 扫描件同框 */
  mesh?: string;
  /** 网格摆放在场景里的位置 */
  position?: [number, number, number];
  /** 绕 X 轴的额外旋转（弧度） */
  rotationX?: number;
  /** 绕 Y 轴的额外旋转（弧度） */
  rotationY?: number;
  /** 统一缩放 */
  scale?: number;
}

export interface Catalog {
  title: string;
  subtitle?: string;
  items: CatalogItem[];
}

const EMPTY: Catalog = { title: '想起的', items: [] };

export async function loadCatalog(url = './catalog.json'): Promise<Catalog> {
  try {
    // 带时间戳，避免改了摆放数据后浏览器仍用缓存（调试摆放时踩过）
    const res = await fetch(`${url}?v=${Date.now()}`);
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as Catalog;
    return Array.isArray(data.items) ? data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** 渲染图鉴面板。onPick 在点击条目时触发。 */
export function renderCatalog(
  root: HTMLElement,
  catalog: Catalog,
  onPick: (item: CatalogItem) => void,
): void {
  root.innerHTML = '';
  root.hidden = false;

  const head = document.createElement('div');
  head.className = 'catalog__head';
  const title = document.createElement('h2');
  title.textContent = catalog.title;
  head.appendChild(title);
  if (catalog.subtitle) {
    const sub = document.createElement('p');
    sub.textContent = catalog.subtitle;
    head.appendChild(sub);
  }
  root.appendChild(head);

  const count = document.createElement('div');
  count.className = 'catalog__count';
  count.textContent = catalog.items.length
    ? `${catalog.items.length} 件讲出来的`
    : '还没有讲出来的';
  root.appendChild(count);

  const list = document.createElement('ul');
  list.className = 'catalog__list';

  for (const item of catalog.items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'catalog__item';
    btn.type = 'button';

    const name = document.createElement('span');
    name.className = 'catalog__name';
    name.textContent = item.name;

    const memory = document.createElement('span');
    memory.className = 'catalog__memory';
    memory.textContent = item.memory;

    btn.append(name, memory);
    btn.addEventListener('click', () => {
      root.querySelectorAll('.catalog__item').forEach((el) => el.classList.remove('is-active'));
      btn.classList.add('is-active');
      onPick(item);
    });

    li.appendChild(btn);
    list.appendChild(li);
  }

  root.appendChild(list);
}
