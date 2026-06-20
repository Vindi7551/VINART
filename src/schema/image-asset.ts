/**
 * 素材产出（Image Asset）
 *
 * 素材师 Agent 的产出。每个槽位对应一个素材师实例，并行独立运行。
 *
 * 素材师的职责：
 * 1. 收到 SlotSpec + CreativeBrief + ImageTreatment
 * 2. 将结构化规格翻译为 vision 模型的正/负向 prompt
 * 3. 调用视觉模型 API 生成图片，拿到下载 URL
 * 4. 下载图片 → 按 {slotId}.{ext} 重命名保存到本地
 * 5. 交出 ImageAsset（含本地文件路径）
 *
 * 不负责判断质量 —— 那是创意总监的活。
 * 不负责调整 prompt 重试 —— 失败或被驳回时编排器重新启动实例。
 */

// ── 图片数据 ──

/** 图片的承载形式 */
export interface ImageData {
  /** base64 编码的图片数据 */
  base64: string;
  /** MIME 类型 */
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 模型 API 返回的原始 URL（24h 有效，仅做溯源） */
  sourceUrl?: string;
  /** 模型实际生成的宽度 px */
  width: number;
  /** 模型实际生成的高度 px */
  height: number;
}

// ── 生成元信息 ──

/**
 * 生成元信息。
 * 记录素材师如何把槽位规格翻译成 prompt 以及模型的响应。
 * 用于调试、复现，以及创意总监驳回时让素材师知道上次是怎么生成的。
 */
export interface GenerationMeta {
  /** 使用的模型名称 */
  model: string;
  /** 正向 prompt */
  positivePrompt: string;
  /** 负向 prompt */
  negativePrompt?: string;
  /** 随机种子 */
  seed?: number;
  /** 生成耗时 ms */
  durationMs?: number;
}

// ── 素材产物 ──

/** 素材生成状态 */
export type AssetStatus = 'completed' | 'failed';

/**
 * 素材师 Agent 对一个槽位的产出。
 */
export interface ImageAsset {
  /** 对应槽位 ID */
  slotId: string;
  /** 对应槽位类型 */
  slotType: string;
  /** 槽位要求的尺寸 */
  targetSize: {
    width: number;
    height: number;
  };
  /** 生成状态 */
  status: AssetStatus;
  /**
   * 下载后重命名的本地文件路径。
   * 命名规则：{slotId}.{ext}，如 "hero-product.png"。
   * 组装师用 slotId 匹配 HTML 中的 data-image-slot 即可定位。
   */
  localPath?: string;
  /** 图片数据（status 为 completed 时必填） */
  image?: ImageData;
  /** 生成元信息 */
  generationMeta?: GenerationMeta;
  /** 失败原因（status 为 failed 时填写） */
  failureReason?: string;
}

// ── 素材批次 ──

/**
 * 一轮素材生成的聚合结果。
 * 编排器收集所有素材师产出后，交给制作 Agent 组装。
 */
export interface AssetBatch {
  /** 素材列表 */
  assets: ImageAsset[];
  /** 成功数 */
  completedCount: number;
  /** 失败数 */
  failedCount: number;
  /** 是否全部成功 */
  allCompleted: boolean;
}
