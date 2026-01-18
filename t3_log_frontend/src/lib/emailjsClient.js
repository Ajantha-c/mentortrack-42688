import emailjs from "@emailjs/browser";

/**
 * EmailJS configuration (provided by user_input_ref).
 * Note: EmailJS public key is safe to ship to the client.
 */
const EMAILJS_SERVICE_ID = "service_2zfntrj";
const EMAILJS_PUBLIC_KEY = "E0uCkdMeCclEJHckD";
const EMAILJS_TEMPLATE_MENTOR_NEW_TASK = "template_9pdgoch";
const EMAILJS_TEMPLATE_INTERN_TASK_UPDATE = "template_vd1beil";

/**
 * Small wrapper to keep EmailJS usage consistent and easy to migrate.
 */
async function sendEmail({ templateId, templateParams }) {
  return emailjs.send(EMAILJS_SERVICE_ID, templateId, templateParams, {
    publicKey: EMAILJS_PUBLIC_KEY,
  });
}

// PUBLIC_INTERFACE
export async function sendMentorNewTaskEmail({
  mentorEmail,
  internName,
  taskTitle,
}) {
  /** Send mentor notification when intern creates a new task. */
  if (!mentorEmail) throw new Error("Missing mentorEmail for EmailJS send.");
  if (!internName) throw new Error("Missing internName for EmailJS send.");
  if (!taskTitle) throw new Error("Missing taskTitle for EmailJS send.");

  return sendEmail({
    templateId: EMAILJS_TEMPLATE_MENTOR_NEW_TASK,
    templateParams: {
      mentor_email: mentorEmail,
      intern_name: internName,
      task_title: taskTitle,
    },
  });
}

// PUBLIC_INTERFACE
export async function sendInternTaskUpdateEmail({
  internEmail,
  internName,
  taskTitle,
}) {
  /** Send intern notification when mentor updates a task (status/remarks/meeting). */
  if (!internEmail) throw new Error("Missing internEmail for EmailJS send.");
  if (!internName) throw new Error("Missing internName for EmailJS send.");
  if (!taskTitle) throw new Error("Missing taskTitle for EmailJS send.");

  return sendEmail({
    templateId: EMAILJS_TEMPLATE_INTERN_TASK_UPDATE,
    templateParams: {
      intern_email: internEmail,
      intern_name: internName,
      task_title: taskTitle,
    },
  });
}
