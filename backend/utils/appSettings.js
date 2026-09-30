const AppSettings = require('../models/AppSettings');

const SINGLETON_FILTER = { singleton: true };

/**
 * Returns the singleton AppSettings document, creating it with schema
 * defaults on first access. Safe to call concurrently — findOneAndUpdate
 * with upsert is atomic, so only one document can ever exist.
 */
const getAppSettings = async () =>
  AppSettings.findOneAndUpdate(
    SINGLETON_FILTER,
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

/**
 * True only when public sign-up is explicitly enabled by an admin.
 * Any error (or a missing document) resolves to false — sign-up is a
 * privileged entry point, so it fails closed.
 */
const isSignUpEnabled = async () => {
  try {
    const settings = await getAppSettings();
    return Boolean(settings?.signUpEnabled);
  } catch {
    return false;
  }
};

/**
 * Sets the sign-up toggle and records which admin changed it.
 */
const setSignUpEnabled = async (signUpEnabled, updatedBy) =>
  AppSettings.findOneAndUpdate(
    SINGLETON_FILTER,
    {
      signUpEnabled: Boolean(signUpEnabled),
      updatedBy: updatedBy || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

/**
 * True only when AI proctoring is globally enabled (the kill switch, plan
 * §31). Fails closed exactly like isSignUpEnabled: a missing document or any
 * error reads as OFF, so proctoring can never turn itself on.
 */
const isProctoringEnabled = async () => {
  try {
    const settings = await getAppSettings();
    return Boolean(settings?.proctoringEnabled);
  } catch {
    return false;
  }
};

/**
 * Sets the proctoring kill switch and records which admin changed it.
 */
const setProctoringEnabled = async (proctoringEnabled, updatedBy) =>
  AppSettings.findOneAndUpdate(
    SINGLETON_FILTER,
    {
      proctoringEnabled: Boolean(proctoringEnabled),
      updatedBy: updatedBy || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

/**
 * True only when restricted strict-CV enforcement is explicitly enabled
 * (decision D8). Off for the entire V1 rollout; fails closed.
 */
const isProctoringStrictCvEnabled = async () => {
  try {
    const settings = await getAppSettings();
    return Boolean(settings?.proctoringStrictCv);
  } catch {
    return false;
  }
};

/**
 * Sets the strict-CV gate and records which admin changed it.
 */
const setProctoringStrictCvEnabled = async (proctoringStrictCv, updatedBy) =>
  AppSettings.findOneAndUpdate(
    SINGLETON_FILTER,
    {
      proctoringStrictCv: Boolean(proctoringStrictCv),
      updatedBy: updatedBy || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

module.exports = {
  getAppSettings,
  isSignUpEnabled,
  setSignUpEnabled,
  isProctoringEnabled,
  setProctoringEnabled,
  isProctoringStrictCvEnabled,
  setProctoringStrictCvEnabled,
};
