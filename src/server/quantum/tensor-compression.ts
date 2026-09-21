import type { KBArticle } from "../../data/kb.ts";
import type { TensorCompressionResult } from "./contracts.ts";

function vectorNorm(values: number[]) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function hashedKnowledgeMatrix(articles: KBArticle[], columns: number) {
  return articles.map(article => {
    const row = Array(columns).fill(0) as number[];
    const words = `${article.title} ${article.keywords.join(" ")} ${article.procedure}`.toLowerCase().match(/[a-z0-9-]{3,}/g) || [];
    for (const word of words) {
      let hash = 2166136261;
      for (const character of word) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      row[(hash >>> 0) % columns] += 1;
    }
    const norm = vectorNorm(row) || 1;
    return row.map(value => value / norm);
  });
}

/** A bounded TT-SVD for a two-site tensor (matrix), represented as an MPS. */
export function compressKnowledgeTensor(articles: KBArticle[], maximumRelativeError = 0.12): TensorCompressionResult {
  const columns = 32;
  const matrix = hashedKnowledgeMatrix(articles, columns);
  const rows = matrix.length;
  const residual = matrix.map(row => [...row]);
  const originalNorm = Math.sqrt(residual.flat().reduce((sum, value) => sum + value * value, 0)) || 1;
  const maxRank = Math.min(rows, columns);
  let retainedRank = 0;
  let relativeError = 1;

  for (let component = 0; component < maxRank && relativeError > maximumRelativeError; component += 1) {
    let right = Array.from({ length: columns }, (_, index) => ((index + component) % 7) + 1);
    for (let iteration = 0; iteration < 40; iteration += 1) {
      const left = residual.map(row => row.reduce((sum, value, index) => sum + value * right[index], 0));
      const next = Array.from({ length: columns }, (_, column) => residual.reduce((sum, row, index) => sum + row[column] * left[index], 0));
      const norm = vectorNorm(next);
      if (norm < 1e-12) break;
      right = next.map(value => value / norm);
    }
    const left = residual.map(row => row.reduce((sum, value, index) => sum + value * right[index], 0));
    if (vectorNorm(left) < 1e-10) break;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) residual[row][column] -= left[row] * right[column];
    }
    retainedRank += 1;
    relativeError = Math.sqrt(residual.flat().reduce((sum, value) => sum + value * value, 0)) / originalNorm;
  }

  const originalParameters = rows * columns;
  const compressedParameters = retainedRank * (rows + columns);
  return {
    method: "TT_SVD_TWO_SITE_MPS",
    source: "INCIDENT_KNOWLEDGE_BASE",
    rows,
    columns,
    retainedRank,
    originalParameters,
    compressedParameters,
    compressionRatio: Number((originalParameters / Math.max(compressedParameters, 1)).toFixed(3)),
    relativeFrobeniusError: Number(relativeError.toFixed(6)),
    maximumRelativeError,
    accuracyGatePassed: relativeError <= maximumRelativeError,
    articleIds: articles.map(article => article.id)
  };
}

export function validTensorCompression(result: TensorCompressionResult) {
  return result.rows > 0 && result.columns > 0 && result.retainedRank > 0 &&
    [result.compressionRatio, result.relativeFrobeniusError, result.maximumRelativeError].every(Number.isFinite) &&
    result.relativeFrobeniusError >= 0 && result.relativeFrobeniusError <= 1 &&
    result.accuracyGatePassed === (result.relativeFrobeniusError <= result.maximumRelativeError);
}
