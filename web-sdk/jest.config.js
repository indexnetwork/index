module.exports = {
  setupFilesAfterEnv: [
    '<rootDir>/__test__/jest.setup.js',
  ],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|less|scss|sass|jpg|jpeg|png|gif|webp|svg)$': '<rootDir>/__test__/mocks/fileMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
    '^.+\\.tsx?$': 'ts-jest'
  },
  testPathIgnorePatterns: [
    '/node_modules/',
  ],
  coveragePathIgnorePatterns: [
    '__test__',
    '/src/services',
    '/src/contexts',
    '/src/themes',
  ],
  collectCoverage: true,
  coverageReporters: ['text', 'lcov'],
};
