-- A fifth health state for a source whose poll was refused: the store answered
-- fine, but the poll found an implausible number of changes and published
-- nothing. Not `error` — nothing is broken; the source is held until a human
-- releases it. Idempotent.

ALTER TYPE "SourceHealth" ADD VALUE IF NOT EXISTS 'held';
