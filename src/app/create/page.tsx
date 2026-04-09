"use client";

import { useState } from "react";
import { WizardStep } from "@/components/wizard/WizardStep";
import { StepBrief } from "@/components/wizard/StepBrief";
import { StepScript } from "@/components/wizard/StepScript";
import { StepFrames } from "@/components/wizard/StepFrames";
import { StepVideo } from "@/components/wizard/StepVideo";
import { StepResult } from "@/components/wizard/StepResult";

const STEPS = [
  { id: 1, label: "Brief" },
  { id: 2, label: "Script" },
  { id: 3, label: "Frames" },
  { id: 4, label: "Video" },
  { id: 5, label: "Result" },
];

export type ProjectData = {
  // Step 1
  videoType: string;
  brandName: string;
  brandColors: string;
  mood: string;
  targetAudience: string;
  productDescription: string;
  uploadedImages: string[]; // R2 URLs
  // Step 2
  script: SceneScript[] | null;
  // Step 3
  keyframes: string[]; // R2 URLs
  selectedFrames: number[];
  // Step 4
  videoClips: string[]; // R2 URLs
  selectedClips: number[];
  musicUrl: string | null;
};

export type SceneScript = {
  sceneNumber: number;
  duration: string;
  description: string;
  visualPrompt: string;
  cameraMovement: string;
};

const initialData: ProjectData = {
  videoType: "",
  brandName: "",
  brandColors: "",
  mood: "",
  targetAudience: "",
  productDescription: "",
  uploadedImages: [],
  script: null,
  keyframes: [],
  selectedFrames: [],
  videoClips: [],
  selectedClips: [],
  musicUrl: null,
};

export default function CreatePage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<ProjectData>(initialData);

  const updateData = (updates: Partial<ProjectData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const goNext = () => setCurrentStep((s) => Math.min(s + 1, 5));
  const goPrev = () => setCurrentStep((s) => Math.max(s - 1, 1));

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header with step indicators */}
      <header className="border-b border-white/10 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <span className="font-semibold text-purple-300">AI Video Factory</span>
            <span className="text-slate-400 text-sm">
              Step {currentStep} of {STEPS.length}
            </span>
          </div>
          <div className="flex gap-2">
            {STEPS.map((step) => (
              <WizardStep
                key={step.id}
                step={step}
                currentStep={currentStep}
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
              />
            ))}
          </div>
        </div>
      </header>

      {/* Step content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {currentStep === 1 && (
          <StepBrief data={data} onUpdate={updateData} onNext={goNext} />
        )}
        {currentStep === 2 && (
          <StepScript data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {currentStep === 3 && (
          <StepFrames data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {currentStep === 4 && (
          <StepVideo data={data} onUpdate={updateData} onNext={goNext} onPrev={goPrev} />
        )}
        {currentStep === 5 && (
          <StepResult data={data} onPrev={goPrev} />
        )}
      </main>
    </div>
  );
}
