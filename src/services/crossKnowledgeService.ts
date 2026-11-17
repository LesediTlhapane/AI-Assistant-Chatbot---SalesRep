/**
 * Maps optional learner context sent by the CrossKnowledge host page.
 */

export interface CrossKnowledgeContext {
  courseId?: string;
  courseName?: string;
  moduleId?: string;
  moduleName?: string;
  lessonId?: string;
  lessonTitle?: string;
  learnerId?: string;
  learnerName?: string;
  learnerRole?: string;
  organization?: string;
}

export class CrossKnowledgeService {
  /**
   * Normalizes metadata received from the host LMS.
   */
  static normalizeContext(rawContext: Partial<CrossKnowledgeContext>): CrossKnowledgeContext {
    return {
      courseId: rawContext.courseId,
      courseName: rawContext.courseName,
      moduleId: rawContext.moduleId,
      moduleName: rawContext.moduleName,
      lessonId: rawContext.lessonId,
      lessonTitle: rawContext.lessonTitle,
      learnerId: rawContext.learnerId,
      learnerName: rawContext.learnerName,
      learnerRole: rawContext.learnerRole,
      organization: rawContext.organization
    };
  }

}
