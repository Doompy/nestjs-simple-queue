# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0]

### Added ✨

- **Enhanced Task Status System**: Improved type-safe task status management with structured status types
  - Added `TaskStatusType` union type for better type safety
  - Added specific status interfaces: `PendingTaskStatus`, `ProcessingTaskStatus`, `CompletedTaskStatus`, `FailedTaskStatus`, `CancelledTaskStatus`, `DelayedTaskStatus`, `NotFoundTaskStatus`
  - Enhanced `getTaskStatus()` method with better type information
- **Comprehensive Test Coverage**: Added extensive tests for new features
  - Processor Management tests (register, update, unregister, check existence)
  - Queue Management tests (clear queues, get tasks)
  - Task Management tests (get by ID, get status, get by queue)
  - Improved overall test coverage from 40.5% to 59.77%
- **Enhanced Type Safety**: Improved TypeScript type definitions throughout the library
  - Better interface definitions with more specific types
  - Enhanced type guards for task status handling

### Changed 🔄

- **Task Status Return Type**: Modified `getTaskStatus()` to return `TaskStatus & { taskId: string }`
  - `taskId` is now automatically included in all status responses
  - Removed redundant `taskId` from individual status interfaces for cleaner structure
- **Interface Improvements**: Enhanced `ProcessorManagement` interface with better method signatures

### Fixed 🐛

- **Type Safety Issues**: Fixed various TypeScript type compatibility issues
- **Test Coverage**: Resolved test failures and improved test reliability
- **Documentation**: Updated README with comprehensive examples for new type system

### Technical Improvements 🔧

- **Better Error Handling**: Improved error handling in processor management methods
- **Code Organization**: Better separation of concerns in status type definitions
- **Performance**: Optimized task status lookup methods

## [2.0.0]

### Breaking Changes ⚠️

- **Job-based Architecture**: Replaced function-based tasks with named job processors
- **API Changes**: `enqueue()` now returns task ID instead of void
- **Module Registration**: New `QueueModule.forRoot()` with processors array

### Added ✨

- **Flexible Processor Registration**: Multiple ways to register processors
  - Static registration via `QueueModule.forRoot()`
  - Decorator-based registration with `@QueueJob`
  - Dynamic registration at runtime
  - Module-based registration with `QueueModule.forFeature()`
- **Advanced Features**: Delayed jobs, task cancellation, state persistence, graceful shutdown
- **Enhanced Monitoring**: Queue statistics, task tracking, comprehensive events
- **Production Features**: Priority queue, concurrent processing, retry mechanism

### Changed 🔄

- **Complete Architecture Overhaul**: From function-based to job-based processing
- **Enhanced TypeScript Support**: Full type safety with comprehensive interfaces
- **Improved Event System**: More detailed task lifecycle events

### Removed 🗑️

- Function-based task enqueueing (replaced with job-based approach)

---

## Version History

### v2.1.0 (Current)

- Enhanced task status system with type-safe interfaces
- Comprehensive test coverage improvements
- Better TypeScript type definitions

### v2.0.0

- Major architecture overhaul to job-based system
- Flexible processor registration methods
- Advanced features (delayed jobs, cancellation, persistence)

### v1.x

- Original function-based implementation
- Basic queue functionality with limited features

---

**For detailed migration guides and examples, see the [README.md](./README.md) file.**
