/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { InputPrompt, InputPromptProps } from './InputPrompt.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { Config } from '@qwen-code/qwen-code-core';
import * as path from 'path';
import {
  CommandContext,
  SlashCommand,
  CommandKind,
} from '../commands/types.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useShellHistory,
  UseShellHistoryReturn,
} from '../hooks/useShellHistory.js';
import {
  useCommandCompletion,
  UseCommandCompletionReturn,
} from '../hooks/useCommandCompletion.js';
import {
  useInputHistory,
  UseInputHistoryReturn,
} from '../hooks/useInputHistory.js';
import * as clipboardUtils from '../utils/clipboardUtils.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

// Mock the core module to spy on UserBehaviorLogger
const mockLogTypingStart = vi.fn();

vi.mock('@qwen-code/qwen-code-core', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    UserBehaviorLogger: {
      getInstance: vi.fn().mockReturnValue({
        logTypingStart: mockLogTypingStart,
      }),
    },
  };
});

vi.mock('../hooks/useShellHistory.js');
vi.mock('../hooks/useCommandCompletion.js');
vi.mock('../hooks/useInputHistory.js');
vi.mock('../utils/clipboardUtils.js');

const mockSlashCommands: SlashCommand[] = [
  {
    name: 'clear',
    kind: CommandKind.BUILT_IN,
    description: 'Clear screen',
    action: vi.fn(),
  },
];

describe('InputPrompt - User Behavior Logging', () => {
  let props: InputPromptProps;
  let mockShellHistory: UseShellHistoryReturn;
  let mockCommandCompletion: UseCommandCompletionReturn;
  let mockInputHistory: UseInputHistoryReturn;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandContext;

  const mockedUseShellHistory = vi.mocked(useShellHistory);
  const mockedUseCommandCompletion = vi.mocked(useCommandCompletion);
  const mockedUseInputHistory = vi.mocked(useInputHistory);

  beforeEach(() => {
    vi.resetAllMocks();

    mockCommandContext = createMockCommandContext();

    mockBuffer = {
      text: '',
      cursor: [0, 0],
      lines: [''],
      setText: vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.lines = [newText];
        mockBuffer.cursor = [0, newText.length];
        mockBuffer.viewportVisualLines = [newText];
        mockBuffer.allVisualLines = [newText];
      }),
      replaceRangeByOffset: vi.fn(),
      viewportVisualLines: [''],
      allVisualLines: [''],
      visualCursor: [0, 0],
      visualScrollRow: 0,
      handleInput: vi.fn(),
      move: vi.fn(),
      moveToOffset: (offset: number) => {
        mockBuffer.cursor = [0, offset];
      },
      killLineRight: vi.fn(),
      killLineLeft: vi.fn(),
      openInExternalEditor: vi.fn(),
      newline: vi.fn(),
      backspace: vi.fn(),
      preferredCol: null,
      selectionAnchor: null,
      insert: vi.fn(),
      del: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      replaceRange: vi.fn(),
      deleteWordLeft: vi.fn(),
      deleteWordRight: vi.fn(),
    } as unknown as TextBuffer;

    mockShellHistory = {
      history: [],
      addCommandToHistory: vi.fn(),
      getPreviousCommand: vi.fn().mockReturnValue(null),
      getNextCommand: vi.fn().mockReturnValue(null),
      resetHistoryPosition: vi.fn(),
    };
    mockedUseShellHistory.mockReturnValue(mockShellHistory);

    mockCommandCompletion = {
      suggestions: [],
      activeSuggestionIndex: -1,
      isLoadingSuggestions: false,
      showSuggestions: false,
      visibleStartIndex: 0,
      isPerfectMatch: false,
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      resetCompletionState: vi.fn(),
      setActiveSuggestionIndex: vi.fn(),
      setShowSuggestions: vi.fn(),
      handleAutocomplete: vi.fn(),
    };
    mockedUseCommandCompletion.mockReturnValue(mockCommandCompletion);

    mockInputHistory = {
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      handleSubmit: vi.fn(),
    };
    mockedUseInputHistory.mockReturnValue(mockInputHistory);

    props = {
      buffer: mockBuffer,
      onSubmit: vi.fn(),
      userMessages: [],
      onClearScreen: vi.fn(),
      config: {
        getProjectRoot: () => path.join('test', 'project'),
        getTargetDir: () => path.join('test', 'project', 'src'),
        getVimMode: () => false,
        getSessionId: () => 'test-session-id',
        getWorkspaceContext: () => ({
          getDirectories: () => ['/test/project/src'],
        }),
      } as unknown as Config,
      slashCommands: mockSlashCommands,
      commandContext: mockCommandContext,
      shellModeActive: false,
      setShellModeActive: vi.fn(),
      inputWidth: 80,
      suggestionsWidth: 80,
      focus: true,
    };
  });

  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

  it('should log typing start event on first keypress', async () => {
    const { stdin, unmount } = render(<InputPrompt {...props} />);
    await wait();

    // Type the first character
    stdin.write('H');
    await wait();

    // Verify that logTypingStart was called
    expect(mockLogTypingStart).toHaveBeenCalled();
    
    // Verify it's only called once
    stdin.write('e');
    await wait();
    expect(mockLogTypingStart).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('should not log typing start event when buffer already has text', async () => {
    // Set initial text in buffer
    mockBuffer.text = 'Hello';
    mockBuffer.lines = ['Hello'];
    mockBuffer.cursor = [0, 5];

    const { stdin, unmount } = render(<InputPrompt {...props} />);
    await wait();

    // Type another character
    stdin.write('!');
    await wait();

    // Verify that logTypingStart was not called
    expect(mockLogTypingStart).not.toHaveBeenCalled();

    unmount();
  });

  it('should not log typing start event for non-printable characters', async () => {
    const { stdin, unmount } = render(<InputPrompt {...props} />);
    await wait();

    // Send a non-printable character (e.g., arrow key)
    stdin.write('\u001B[A'); // Up arrow
    await wait();

    // Verify that logTypingStart was not called
    expect(mockLogTypingStart).not.toHaveBeenCalled();

    unmount();
  });

  it('should not log typing start event for whitespace-only characters', async () => {
    const { stdin, unmount } = render(<InputPrompt {...props} />);
    await wait();

    // Send a space character
    stdin.write(' ');
    await wait();

    // Verify that logTypingStart was not called (since we only log for non-whitespace)
    expect(mockLogTypingStart).not.toHaveBeenCalled();

    unmount();
  });
});