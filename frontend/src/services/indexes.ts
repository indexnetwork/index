export interface Index {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  files: IndexFile[];
  suggestedIntents: SuggestedIntent[];
  avatar?: string;
  role?: string;
}

export interface IndexFile {
  name: string;
  size: string;
  date: string;
}

export interface SuggestedIntent {
  id: string;
  title: string;
  isAdded?: boolean;
}

// Mock data
const mockIndexes: Index[] = [
  {
    id: "1",
    name: "2025 Thesis",
    createdAt: "March 15, 2024",
    members: 3,
    files: [
      { name: "2025 Thesis.pdf", size: "2.4 MB", date: "2024-03-20" },
      { name: "portfolio.csv", size: "1.1 MB", date: "2024-03-19" },
      { name: "blog.md", size: "4.2 MB", date: "2024-03-18" },
      { name: "thesis.pptx", size: "5.6 MB", date: "2024-03-17" },
      { name: "notes.txt", size: "0.3 MB", date: "2024-03-16" },
    ],
    suggestedIntents: [
      {
        id: "1",
        title: "Looking for AI researchers working on multi-agent systems",
        isAdded: false
      },
      {
        id: "2",
        title: "Interested in connecting with developers building privacy-preserving protocols",
        isAdded: false
      }
    ]
  }, {
    id: "2",
    name: "My first index",
    createdAt: "March 15, 2024",
    members: 3,
    files: [],
    suggestedIntents: [
      {
        id: "3",
        title: "Looking for protocols startups building new coordination models",
        isAdded: false
      },
      {
        id: "4",
        title: "Interested in open networks that enables new ownership, identity",
        isAdded: false
      },
      {
        id: "5",
        title: "Looking for protocols rethinking how value moves, aggregates, or is secured",
        isAdded: false
      }
    ]
  }
];

// Mock service functions
export const indexesService = {
  getIndexes: (): Promise<Index[]> => {
    return new Promise((resolve) => {
      resolve(mockIndexes);
    });
  },

  getIndex: (id: string): Promise<Index | undefined> => {
    return new Promise((resolve) => {
      resolve(mockIndexes.find(index => index.id === id));
    });
  },

  createIndex: (index: Omit<Index, 'id'>): Promise<Index> => {
    return new Promise((resolve) => {
      const newIndex = {
        ...index,
        id: Math.random().toString(36).substr(2, 9)
      };
      mockIndexes.push(newIndex);
      resolve(newIndex);
    });
  },

  updateIndex: (id: string, updates: Partial<Index>): Promise<Index | undefined> => {
    return new Promise((resolve) => {
      const index = mockIndexes.findIndex(index => index.id === id);
      if (index !== -1) {
        mockIndexes[index] = { ...mockIndexes[index], ...updates };
        resolve(mockIndexes[index]);
      } else {
        resolve(undefined);
      }
    });
  },

  deleteIndex: (id: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const index = mockIndexes.findIndex(index => index.id === id);
      if (index !== -1) {
        mockIndexes.splice(index, 1);
        resolve(true);
      } else {
        resolve(false);
      }
    });
  },

  uploadFile: (indexId: string, file: File): Promise<IndexFile> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const index = mockIndexes.find(index => index.id === indexId);
        if (index) {
          const newFile = {
            name: file.name,
            size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
            date: new Date().toISOString().split('T')[0]
          };
          index.files.unshift(newFile);
          resolve(newFile);
        } else {
          throw new Error('Index not found');
        }
      }, 3000);
    });
  },

  deleteFile: (indexId: string, fileName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const index = mockIndexes.find(index => index.id === indexId);
      if (index) {
        const fileIndex = index.files.findIndex(file => file.name === fileName);
        if (fileIndex !== -1) {
          index.files.splice(fileIndex, 1);
          resolve(true);
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  },

  addSuggestedIntent: (indexId: string, intentId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const indexIndex = mockIndexes.findIndex(index => index.id === indexId);
      if (indexIndex !== -1) {
        const intentIndex = mockIndexes[indexIndex].suggestedIntents.findIndex(intent => intent.id === intentId);
        if (intentIndex !== -1) {
          // Create a new array to ensure state update
          const updatedIntents = [...mockIndexes[indexIndex].suggestedIntents];
          updatedIntents[intentIndex] = {
            ...updatedIntents[intentIndex],
            isAdded: true
          };
          mockIndexes[indexIndex].suggestedIntents = updatedIntents;
          resolve(true);
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  },

  requestConnection: (indexId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const index = mockIndexes.find(index => index.id === indexId);
      if (index) {
        // In a real implementation, this would send a connection request
        // For now, we'll just simulate success
        resolve(true);
      } else {
        resolve(false);
      }
    });
  }
}; 