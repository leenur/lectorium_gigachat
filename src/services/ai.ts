export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

export interface AnalysisResult {
  summary: string;
  quiz: QuizQuestion[];
}

export async function analyzePdf(base64Data: string): Promise<AnalysisResult> {
  const response = await fetch('/api/ai/analyze-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pdfBase64: base64Data }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to analyze PDF');
  }

  return response.json();
}
