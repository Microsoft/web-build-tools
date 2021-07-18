// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as ts from 'typescript';
import { ParserContext, StandardTags, TSDocParser } from '@microsoft/tsdoc';

import { Collector } from '../collector/Collector';
import { ExtractorMessageId } from '../api/ExtractorMessageId';
import { Sort } from '@rushstack/node-core-library';

export class PackageDocComment {
  /**
   * For the given source file, see if it starts with a TSDoc comment containing the `@packageDocumentation` tag.
   */
  public static tryFindInSourceFile(
    sourceFile: ts.SourceFile,
    collector: Collector
  ): ts.TextRange | undefined {
    let packageCommentRange: ts.TextRange | undefined = undefined; // empty string

    const commentRanges: ts.CommentRange[] = [];
    const commentRangesPosSet: Set<number> = new Set();

    function collectCommentRanges(newCommentRanges: ts.CommentRange[] | undefined): void {
      if (newCommentRanges !== undefined) {
        for (const commentRange of newCommentRanges) {
          // Have we already visited this comment before?
          if (!commentRangesPosSet.has(commentRange.pos)) {
            commentRangesPosSet.add(commentRange.pos);
            commentRanges.push(commentRange);
          }
        }
      }
    }

    // Pick out the top-level comments only
    collectCommentRanges(ts.getLeadingCommentRanges(sourceFile.text, sourceFile.getFullStart()));
    for (const statement of sourceFile.statements) {
      collectCommentRanges(ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()));
      collectCommentRanges(ts.getTrailingCommentRanges(sourceFile.text, statement.getEnd()));
    }

    // Order them by the order they appear in the file
    Sort.sortBy(commentRanges, (x) => x.pos);

    let pastFirstComment: boolean = false;

    for (const commentRange of commentRanges) {
      if (commentRange.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
        const commentBody: string = sourceFile.text.substring(commentRange.pos, commentRange.end);

        // Only consider TSDoc-style comments
        if (/^\s*\/\*\*/.test(commentBody)) {
          // Does it have the "@packageDocumentation" substring?  Note that the RegExp may incorrectly match
          // something like:
          //
          //    /**
          //     * This function tests whether the tag is the `@packageDocumentation` tag.
          //     */
          //
          // We need the real TSDoc parser to determine for sure whether the tag is present.
          if (/\@packageDocumentation/i.test(commentBody)) {
            const parser: TSDocParser = new TSDocParser();
            const parserContext: ParserContext = parser.parseString(commentBody);
            if (parserContext.docComment.modifierTagSet.hasTag(StandardTags.packageDocumentation)) {
              if (pastFirstComment) {
                // The @packageDocumentation comment is special because it is not attached to an AST
                // definition.  Instead, it is part of the "trivia" tokens that the compiler treats
                // as irrelevant white space.
                //
                // WARNING: If the comment doesn't precede an export statement, the compiler will omit
                // it from the *.d.ts file, and API Extractor won't find it.  If this happens, you need
                // to rearrange your statements to ensure it is passed through.  To minimize confusion,
                // API Extractor normally requires that the "@packageDocumentation" will be in the first
                // TSDoc comment that appears in the entry point *.d.ts file.
                //
                // If you need to locate the comment elsewhere in your file, use api-extractor.json to
                // suppress the "ae-misplaced-package-tag" message.
                collector.messageRouter.addAnalyzerIssueForPosition(
                  ExtractorMessageId.MisplacedPackageTag,
                  'The @packageDocumentation comment must appear at the top of entry point *.d.ts file',
                  sourceFile,
                  commentRange.pos
                );
              }

              packageCommentRange = commentRange;
              break;
            }
          }

          pastFirstComment = true;
        }
      }
    }

    return packageCommentRange;
  }
}
