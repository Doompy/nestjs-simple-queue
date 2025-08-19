// Jest 설정 파일 - 모든 에러와 출력 완전 차단
beforeAll(() => {
  // 모든 콘솔 출력 차단
  global.console = {
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    dir: jest.fn(),
    dirxml: jest.fn(),
    group: jest.fn(),
    groupCollapsed: jest.fn(),
    groupEnd: jest.fn(),
    time: jest.fn(),
    timeEnd: jest.fn(),
    timeLog: jest.fn(),
    profile: jest.fn(),
    profileEnd: jest.fn(),
    count: jest.fn(),
    countReset: jest.fn(),
    clear: jest.fn(),
    table: jest.fn(),
    assert: jest.fn(),
  };

  // process 출력 차단
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

  // 전역 에러 핸들러 차단
  global.process = {
    ...process,
    stderr: {
      ...process.stderr,
      write: jest.fn(() => true),
    },
    stdout: {
      ...process.stdout,
      write: jest.fn(() => true),
    },
  };

  // Error 객체 출력 차단
  const originalError = Error;
  global.Error = class extends originalError {
    constructor(message) {
      super(message);
      // 에러 스택 트레이스 차단
      this.stack = undefined;
    }
  };
});

afterAll(() => {
  // 테스트 완료 후 원래대로 복원
  jest.restoreAllMocks();
});

// 각 테스트 전에 모든 출력 차단
beforeEach(() => {
  // 모든 콘솔 메서드를 빈 함수로 설정
  Object.keys(console).forEach((key) => {
    if (typeof console[key] === 'function') {
      jest.spyOn(console, key).mockImplementation(() => {});
    }
  });
});

// 각 테스트 후에 모든 출력 복원
afterEach(() => {
  jest.restoreAllMocks();
});
