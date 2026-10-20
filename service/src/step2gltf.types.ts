export type SourceEncoding = 'gbk' | 'gb2312' | 'utf8' | 'none';

export interface ConversionOptions {
  encoding?: SourceEncoding;
  linear?: number;
  angular?: number;
  preview?: boolean;
  deepLinear?: number;
  deepAngular?: number;
  deepRatio?: number;
  deepError?: number;
  verbose?: boolean;
}

export interface ConversionResult {
  conversionId: string;
  outputPath: string;
  cleanup: () => Promise<void>;
}
