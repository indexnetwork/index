export enum IndexStatus {
  Init = 'init',
  Success = 'success',
  Fail = 'fail',
}

export enum Participant {
  User = 'user',
  Assistant = 'assistant',
}

export type Message = {
  content: string;
  role: Participant;
};

export type ParticipantProfile = {
  id: string;
  name: string;
  avatar: string;
  bio: string;
};
