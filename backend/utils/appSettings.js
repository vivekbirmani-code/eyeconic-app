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

module.exports = { getAppSettings, isSignUpEnabled, setSignUpEnabled };
