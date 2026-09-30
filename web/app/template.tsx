"use client";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";

/** Every page enters the same way: a short rise out of a soft blur. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }} transition={{ duration: 0.8, ease: EASE }}>
      {children}
    </motion.div>
  );
}
