export interface QuestionOption {
  label: string;
  description: string;
}

export interface Question {
  title: string;
  prompt: string;
  options: QuestionOption[];
  multiSelect: boolean;
}
