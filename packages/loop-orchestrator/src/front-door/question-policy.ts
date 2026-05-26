import type { ProjectKind } from "../evaluation-policy.js";

export type FrontDoorLocale = "en" | "ko";

export type ProductQuestionField =
  | "product_summary"
  | "target_users"
  | "core_workflows"
  | "references"
  | "finish_line";

export type ExecutionQuestionField =
  | "project_mode"
  | "target_root"
  | "target_score"
  | "max_rounds"
  | "run_command"
  | "ready_url";

const localized = (
  locale: FrontDoorLocale,
  ko: string,
  en: string
): string => (locale === "ko" ? ko : en);

const projectKindProductQuestions: Partial<
  Record<ProjectKind, Partial<Record<ProductQuestionField, { ko: string; en: string }>>>
> = {
  cli_tool: {
    target_users: {
      ko: "이 CLI를 주로 실행할 사용자나 상황을 적어줘.",
      en: "Who will run this CLI, and in what situation?"
    },
    core_workflows: {
      ko: "대표 실행 명령과 입력 예시를 2~3개 적어줘.",
      en: "List 2-3 representative commands with example inputs."
    },
    finish_line: {
      ko: "성공 시 stdout/파일 산출물과 반드시 다룰 실패 케이스를 적어줘.",
      en: "What stdout/file outputs prove success, and which failure cases must be handled?"
    }
  },
  library_package: {
    target_users: {
      ko: "이 패키지를 사용할 개발자와 런타임/프로젝트 맥락을 적어줘.",
      en: "Who will use this package, and in what runtime or project context?"
    },
    core_workflows: {
      ko: "처음 공개할 함수/클래스/API와 import 또는 사용 예시를 적어줘.",
      en: "Which public functions, classes, or API/import examples must work first?"
    },
    finish_line: {
      ko: "성공을 증명할 설치/import/사용 예시와 중요한 호환성 또는 오류 동작을 적어줘.",
      en: "What install/import/use example proves success, and what compatibility or error behavior matters?"
    }
  },
  agent_workflow: {
    target_users: {
      ko: "누가 이 에이전트를 쓰고 어떤 일을 맡기는지 적어줘.",
      en: "Who will use this agent, and what task are they delegating?"
    },
    core_workflows: {
      ko: "대표 입력 프롬프트/작업 3개와 기대 응답 결과를 적어줘.",
      en: "List representative input prompts/tasks and the expected response outcomes."
    },
    finish_line: {
      ko: "좋은 응답과 나쁜 응답을 가르는 기준, 실패 시 재질문/안전 거절 여부를 적어줘.",
      en: "What separates a good response from a bad one, and should failures trigger a clarifying question or safe refusal?"
    }
  },
  document_artifact: {
    target_users: {
      ko: "최종 문서를 읽거나 승인할 사람과 의사결정 맥락을 적어줘.",
      en: "Who will read or approve this artifact, and for what decision?"
    },
    core_workflows: {
      ko: "최종 산출물 형식, 필수 섹션, 입력 자료를 적어줘.",
      en: "What final document format, required sections, and source inputs must exist?"
    },
    finish_line: {
      ko: "좋은 산출물로 인정하려면 반드시 포함/제외할 내용을 적어줘.",
      en: "What must be included or excluded for the artifact to be good enough?"
    }
  },
  data_pipeline: {
    target_users: {
      ko: "이 파이프라인을 실행하거나 결과를 소비할 사람과 대상 데이터를 적어줘.",
      en: "Who will run or consume this pipeline, and on what data?"
    },
    core_workflows: {
      ko: "입력 소스, 스키마 가정, 변환, 출력 산출물을 적어줘.",
      en: "What input sources, schema assumptions, transforms, and outputs must work first?"
    },
    finish_line: {
      ko: "성공을 증명할 출력 파일/리포트와 bad-row 또는 누락 데이터 처리 기준을 적어줘.",
      en: "What output files/reports prove success, and what bad-row or missing-data cases must be handled?"
    }
  },
  automation: {
    target_users: {
      ko: "이 자동화를 운영할 사람과 실행 시점/조건을 적어줘.",
      en: "Who owns or operates this automation, and when does it run?"
    },
    core_workflows: {
      ko: "트리거, 명령/스케줄, 관찰 가능한 결과를 적어줘.",
      en: "What trigger, command, schedule, and observable result must work first?"
    },
    finish_line: {
      ko: "실행 성공을 증명할 산출물과 실패/알림 동작을 적어줘.",
      en: "What success artifact proves it ran, and what failure or alert behavior matters?"
    }
  }
};

export const productQuestionFor = (input: {
  field: ProductQuestionField;
  locale: FrontDoorLocale;
  projectKind?: ProjectKind;
}): string | undefined => {
  const projectQuestion =
    input.projectKind &&
    projectKindProductQuestions[input.projectKind]?.[input.field];
  if (projectQuestion) {
    return localized(input.locale, projectQuestion.ko, projectQuestion.en);
  }

  switch (input.field) {
    case "product_summary":
      return localized(
        input.locale,
        "정확히 뭘 만드는지 한 문장으로 고정해줘.",
        "Summarize exactly what needs to be built in one sentence."
      );
    case "target_users":
      return localized(
        input.locale,
        "누가 이걸 주로 쓰는지 말해줘. 가장 중요한 사용자 한 종류부터 적어줘.",
        "Who is the primary user for the first version?"
      );
    case "core_workflows":
      return localized(
        input.locale,
        "첫 버전에서 사용자가 반드시 해야 하는 핵심 작업 2~3개를 적어줘.",
        "Which 2-3 core workflows must work in the first version?"
      );
    case "references":
      return localized(
        input.locale,
        "참고 제품이나 참고 화면이 있나? 없으면 없다고 적어줘.",
        "Are there reference products or visuals to follow? If not, say none."
      );
    case "finish_line":
      return localized(
        input.locale,
        "첫 버전에서 어디까지 되면 성공인지 짧게 적어줘.",
        "What does good enough for the first version mean?"
      );
  }
};

export const executionQuestionFor = (input: {
  field: ExecutionQuestionField;
  locale: FrontDoorLocale;
  projectKind?: ProjectKind;
}): string | undefined => {
  switch (input.field) {
    case "project_mode":
      return localized(
        input.locale,
        "새 프로젝트인지 기존 프로젝트인지 알려줘.",
        "Is this a new project or an existing project?"
      );
    case "target_root":
      return localized(
        input.locale,
        "작업 폴더가 어디인지 경로를 그대로 적어줘.",
        "What is the working folder path?"
      );
    case "target_score":
      return localized(
        input.locale,
        "target score를 0~1 사이 숫자로 적어줘. 예: 0.9",
        "What target score should the loop use between 0 and 1? Example: 0.9"
      );
    case "max_rounds":
      return localized(
        input.locale,
        "max rounds를 몇 번으로 둘지 적어줘. 예: 4",
        "How many max rounds should the loop use? Example: 4"
      );
    case "run_command":
      if (
        input.projectKind === "cli_tool" ||
        input.projectKind === "data_pipeline" ||
        input.projectKind === "automation" ||
        input.projectKind === "library_package"
      ) {
        return localized(
          input.locale,
          "기존 프로젝트면 대표 실행/검증 명령을 적어줘. 예: npm test 또는 node ./bin/tool.js sample.log",
          "If this is an existing project, what command should the loop run or check? Example: npm test or node ./bin/tool.js sample.log"
        );
      }
      return localized(
        input.locale,
        "기존 프로젝트면 실행 명령을 적어줘. 예: npm run dev",
        "If this is an existing project, what run command should the loop use? Example: npm run dev"
      );
    case "ready_url":
      return localized(
        input.locale,
        "기존 프로젝트면 준비 완료를 확인할 URL을 적어줘. 예: http://127.0.0.1:3000/",
        "If this is an existing project, what ready URL should the loop check? Example: http://127.0.0.1:3000/"
      );
  }
};
