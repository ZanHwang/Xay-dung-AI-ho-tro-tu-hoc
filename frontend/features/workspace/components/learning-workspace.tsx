"use client";

import { useQuizzes } from "@/features/quiz/hooks/use-quizzes";
import { useQuizOverlay } from "@/features/quiz/hooks/use-quiz-overlay";
import { QuizOverlay } from "@/features/quiz/components/quiz-overlay";
import { pageTitles } from "@/config/navigation";
import type { UserProfile } from "@/features/auth/services/auth-api";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { DashboardPage } from "@/features/dashboard/pages/dashboard-page";
import { SettingsPage } from "@/features/settings/pages/settings-page";
import { SubjectsPage } from "@/features/subjects/pages/subjects-page";
import { TutorPage } from "@/features/tutor/pages/tutor-page";
import { EssayPage } from "@/features/essay/pages/essay-page";
import { ClassesPage } from "@/features/classes/pages/classes-page";
import { useConversations } from "@/features/tutor/hooks/use-conversations";
import { useLearningWorkspace } from "@/features/workspace/hooks/use-learning-workspace";

export function LearningWorkspace({ user, onLogout }: { user: UserProfile; onLogout: () => void }) {
  const chats = useConversations(user.id);
  const quizzes = useQuizzes(user.id);
  const overlay = useQuizOverlay(quizzes);
  const workspace = useLearningWorkspace(chats.store.startNew);

  const pageTitle = workspace.selectedSubject?.name ?? pageTitles[workspace.activePage];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background md:flex-row">
      <AppSidebar
        user={user}
        onLogout={onLogout}
        activePage={workspace.activePage}
        onNavigate={workspace.navigate}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader title={pageTitle} onOpenReview={overlay.openReview} />
        {workspace.error ? (
          <div className="banner flex items-center justify-between gap-3" role="alert">
            <span className="flex-1">{workspace.error}</span>
            <button
              type="button"
              onClick={workspace.retryLoadSubjects}
              disabled={workspace.loading}
              className="btn btn-sm btn-outline shrink-0"
            >
              {workspace.loading ? "Đang tải…" : "Thử lại"}
            </button>
          </div>
        ) : null}
        {overlay.reviewError ? (
          <div className="banner flex items-center justify-between gap-3" role="alert">
            <span className="flex-1">{overlay.reviewError}</span>
          </div>
        ) : null}
        <main className="content min-h-0 flex-1 overflow-y-auto">
          {workspace.activePage === "dashboard" ? (
            <DashboardPage
              userName={user.name}
              quizzes={quizzes}
              subjects={workspace.subjects}
              conversations={chats.conversations}
              onNavigate={workspace.navigate}
              onOpenSubject={workspace.openSubject}
              onViewQuiz={overlay.open}
              onOpenReview={overlay.openReview}
              onOpenConversation={(id) => {
                chats.store.select(id);
                workspace.navigate("tutor", true);
              }}
            />
          ) : null}
          {workspace.activePage === "tutor" ? (
            <TutorPage
              isVisible={true}
              subjects={workspace.subjects}
              chats={chats}
              onCreateQuiz={(subjectId) => subjectId ? workspace.openSubject(subjectId) : workspace.navigate("subjects")}
            />
          ) : null}
          {workspace.activePage === "subjects" ? (
            <SubjectsPage
              quizzes={quizzes}
              subjects={workspace.subjects}
              selectedSubject={workspace.selectedSubject}
              onBack={workspace.clearSelectedSubject}
              onOpen={workspace.openSubject}
              onCreate={workspace.addSubject}
              onUpdate={workspace.updateSubject}
              onDelete={workspace.deleteSubject}
              onAskTutor={(id) => {
                chats.store.startNew(id);
                workspace.navigate("tutor", true);
              }}
            />
          ) : null}
          {workspace.activePage === "settings" ? <SettingsPage profile={user} /> : null}
          {workspace.activePage === "essay" ? <EssayPage /> : null}
          {workspace.activePage === "classes" ? <ClassesPage profile={user} /> : null}
        </main>
      </div>
      <QuizOverlay
        key={overlay.token}
        quiz={overlay.viewing}
        quizzes={quizzes}
        initialAttemptId={overlay.attemptId}
        autoStart={overlay.autoStart}
        onClose={overlay.close}
        onSwitchQuiz={overlay.switchTo}
      />
    </div>
  );
}
