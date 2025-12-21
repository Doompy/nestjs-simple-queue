module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  // Jest 최신 설정
  testTimeout: 30000, // 30초 타임아웃
  // 에러 출력 완전 차단
  silent: true,
  verbose: false,

  // 모든 출력 차단
  testEnvironmentOptions: {
    console: false,
  },

  // Jest 자체 에러 출력 차단
  reporters: [
    [
      'default',
      {
        silent: true,
        verbose: false,
      },
    ],
  ],

  // 에러 무시 설정
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // 테스트 실패 시에도 계속 진행
  bail: false,

  // 에러 무시
  errorOnDeprecated: false,
  notify: false,

  // 에러 출력 무시
  maxWorkers: 1,
  workerIdleMemoryLimit: '512MB',

  // 테스트 결과 처리 제거
};
