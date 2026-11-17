import type { Directory } from 'expo-file-system';
import { sqlLearnStore } from '../../core/learn/sql-store';
import type { LearnStore } from '../../core/learn/store';
import { createExpoRunner } from './sqlite';

export function createExpoLearnStore(root: Directory, file = 'learn.sqlite'): LearnStore {
  return sqlLearnStore(createExpoRunner(root, file));
}
