import ModelDefinition from './ModelDefinition';
import primitiveProperty from './primitiveProperty';

export interface InfoSection {
    name: string;
    content: string;
}

export default function mixCatalogMemberDefinition<TBase extends ModelDefinition.Constructor>(Base: TBase) {
    class CatalogMemberDefinition extends Base {
        @primitiveProperty({
            type: 'string',
            name: 'Name',
            description: 'The name of the catalog item.'
        })
        name: string;

        @primitiveProperty({
            type: 'string',
            name: 'Description',
            description: 'The description of the catalog item. Markdown and HTML may be used.'
        })
        description: string;

        @primitiveProperty({
            type: 'string',
            name: 'Name in catalog',
            description: 'The name of the item to be displayed in the catalog, if it is different from the one to display in the workbench.'
        })
        nameInCatalog: string;

        @primitiveProperty({
            type: 'string',
            name: 'Name in catalog',
            description: 'The name of the item to be displayed in the workbench, if it is different from the one to display in the catalog.'
        })
        nameInWorkbench: string;

        // @modelReferenceArrayProperty({
        //     name: 'Info',
        //     description: 'Human-readable information about this dataset.',
        //     idProperty: 'name'
        // })
        // info: InfoSection[];
    }

    return CatalogMemberDefinition;
}