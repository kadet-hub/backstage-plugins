import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createKadetHubRecipeAction } from './actions/recipe';

export const scaffolderModule = createBackendModule({
  moduleId: 'kadet-hub',
  pluginId: 'scaffolder',
  register({ registerInit }) {
    registerInit({
      deps: { scaffolderActions: scaffolderActionsExtensionPoint },
      async init({ scaffolderActions }) {
        scaffolderActions.addActions(createKadetHubRecipeAction());
      },
    });
  },
});
